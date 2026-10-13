//! The process lifecycle: the serve loop with its shutdown deadline, and the
//! compiled binary on a real socket with SIGTERM and SIGINT.
//!
//! The serve loop tests use a short grace period and their own routes. The
//! binary tests start the server with synthetic settings and call only the
//! operational routes, so the server sends no upstream request. The tests
//! open local ports, so they need permission to listen on a socket.

#![cfg(unix)]
#![expect(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    reason = "the helpers of this test binary fail a check by panicking"
)]

use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::process::{Child, Command, ExitStatus, Stdio};
use std::sync::mpsc::{Receiver, RecvTimeoutError, channel};
use std::time::{Duration, Instant};

use axum::Router;
use axum::routing::get;
use psstore_server::lifecycle::{self, Stopped};
use serde_json::Value;
use tokio::sync::oneshot;

// ---- The serve loop ----------------------------------------------------------

/// A serve loop on a free local port with a test router.
struct Loop {
    port: u16,
    stop: Option<oneshot::Sender<()>>,
    served: tokio::task::JoinHandle<std::io::Result<Stopped>>,
}

impl Loop {
    async fn start(router: Router, grace: Duration) -> Self {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let (stop, stopped) = oneshot::channel::<()>();
        let shutdown = async move {
            // A dropped sender also stops the loop.
            stopped.await.ok();
        };
        let served = tokio::spawn(lifecycle::serve(listener, router, shutdown, grace));
        Self {
            port,
            stop: Some(stop),
            served,
        }
    }

    /// Sends the stop signal and waits at most `limit` for the loop to end.
    /// Returns the outcome and the time from the signal to the end.
    async fn stop_within(mut self, limit: Duration) -> (Stopped, Duration) {
        let signalled = Instant::now();
        self.stop.take().unwrap().send(()).unwrap();
        let outcome = tokio::time::timeout(limit, self.served)
            .await
            .expect("the serve loop ends within the limit")
            .unwrap()
            .unwrap();
        (outcome, signalled.elapsed())
    }
}

/// Sends one request on a new connection and keeps the connection open.
fn send_request(port: u16, path: &str, keep_alive: bool) -> TcpStream {
    let mut stream = TcpStream::connect(("127.0.0.1", port)).unwrap();
    stream
        .set_read_timeout(Some(Duration::from_secs(10)))
        .unwrap();
    let connection = if keep_alive { "keep-alive" } else { "close" };
    write!(
        stream,
        "GET {path} HTTP/1.1\r\nHost: localhost\r\nConnection: {connection}\r\n\r\n"
    )
    .unwrap();
    stream
}

/// Reads the response head and a body of `Content-Length` bytes.
fn read_response(stream: &mut TcpStream) -> String {
    let mut reader = BufReader::new(stream);
    let mut head = String::new();
    let mut length = 0;
    loop {
        let mut line = String::new();
        reader.read_line(&mut line).unwrap();
        if let Some(value) = line.to_ascii_lowercase().strip_prefix("content-length:") {
            length = value.trim().parse().unwrap();
        }
        head.push_str(&line);
        if line == "\r\n" || line.is_empty() {
            break;
        }
    }
    let mut body = vec![0; length];
    reader.read_exact(&mut body).unwrap();
    head + &String::from_utf8(body).unwrap()
}

#[tokio::test]
async fn an_idle_server_stops_promptly_on_the_shutdown_signal() {
    let router = Router::new().route("/ok", get(|| async { "ok" }));
    let served = Loop::start(router, Duration::from_secs(30)).await;

    // A browser keeps an idle connection open after its request.
    let port = served.port;
    let idle_connection = tokio::task::spawn_blocking(move || {
        let mut stream = send_request(port, "/ok", true);
        let reply = read_response(&mut stream);
        assert!(reply.starts_with("HTTP/1.1 200"), "{reply}");
        // The server closes the idle connection at shutdown: end of stream.
        let mut rest = Vec::new();
        stream.read_to_end(&mut rest).unwrap();
        rest
    });
    tokio::time::sleep(Duration::from_millis(200)).await;

    let (outcome, waited) = served.stop_within(Duration::from_secs(5)).await;
    assert_eq!(outcome, Stopped::Drained);
    assert!(waited < Duration::from_secs(2), "{waited:?}");
    assert_eq!(idle_connection.await.unwrap(), Vec::<u8>::new());
}

#[tokio::test]
async fn an_active_request_finishes_within_the_grace_period() {
    let router = Router::new().route(
        "/slow",
        get(|| async {
            tokio::time::sleep(Duration::from_millis(300)).await;
            "done"
        }),
    );
    let served = Loop::start(router, Duration::from_secs(10)).await;
    let port = served.port;
    let request = tokio::task::spawn_blocking(move || {
        let mut stream = send_request(port, "/slow", false);
        read_response(&mut stream)
    });
    tokio::time::sleep(Duration::from_millis(100)).await;

    let (outcome, waited) = served.stop_within(Duration::from_secs(5)).await;
    assert_eq!(outcome, Stopped::Drained);
    assert!(waited < Duration::from_secs(2), "{waited:?}");
    let reply = request.await.unwrap();
    assert!(reply.starts_with("HTTP/1.1 200"), "{reply}");
    assert!(reply.ends_with("done"), "{reply}");
}

#[tokio::test]
async fn an_active_request_does_not_outlive_the_deadline() {
    let (started, request_started) = oneshot::channel::<()>();
    let started = std::sync::Arc::new(std::sync::Mutex::new(Some(started)));
    let router = Router::new().route(
        "/never",
        get(move || {
            if let Some(started) = started.lock().unwrap().take() {
                started.send(()).ok();
            }
            std::future::pending::<&'static str>()
        }),
    );
    let grace = Duration::from_millis(500);
    let served = Loop::start(router, grace).await;
    let port = served.port;
    // A thread of its own: the request never ends, and the test does not
    // wait for it.
    std::thread::spawn(move || {
        let mut stream = send_request(port, "/never", false);
        let mut rest = Vec::new();
        stream.read_to_end(&mut rest).ok();
    });
    tokio::time::timeout(Duration::from_secs(5), request_started)
        .await
        .expect("the request reaches the handler")
        .unwrap();

    let (outcome, waited) = served.stop_within(Duration::from_secs(5)).await;
    assert_eq!(outcome, Stopped::DeadlineReached);
    assert!(waited >= grace, "{waited:?}");
    assert!(waited < grace + Duration::from_secs(2), "{waited:?}");
}

// ---- The binary ----------------------------------------------------------------

/// The binary must stop well within the grace period when it is idle.
const IDLE_SHUTDOWN_LIMIT: Duration = Duration::from_secs(10);
const STARTUP_LIMIT: Duration = Duration::from_secs(20);
const COMMIT: &str = "0123456789abcdef0123456789abcdef01234567";

/// A running server process. Drop kills the process if a test fails early.
struct Server {
    child: Child,
    lines: Receiver<Value>,
}

impl Drop for Server {
    fn drop(&mut self) {
        self.child.kill().ok();
        self.child.wait().ok();
    }
}

impl Server {
    /// Starts the binary on `port` with synthetic settings only.
    fn start(port: u16) -> Self {
        let mut child = Command::new(env!("CARGO_BIN_EXE_psstore-server"))
            .env_clear()
            .env("PORT", port.to_string())
            .env("RAILWAY_GIT_COMMIT_SHA", COMMIT)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        let stdout = child.stdout.take().unwrap();
        let (sender, lines) = channel();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines() {
                let Ok(line) = line else { break };
                let value = serde_json::from_str(&line).expect("each log line is JSON");
                if sender.send(value).is_err() {
                    break;
                }
            }
        });
        Self { child, lines }
    }

    /// Waits for a log line with `message`.
    fn wait_for(&self, message: &str, limit: Duration) -> Value {
        let deadline = Instant::now() + limit;
        loop {
            let left = deadline.saturating_duration_since(Instant::now());
            match self.lines.recv_timeout(left) {
                Ok(line) if line["message"] == message => return line,
                Ok(_) => {}
                Err(RecvTimeoutError::Timeout) => panic!("no {message:?} log line"),
                Err(RecvTimeoutError::Disconnected) => {
                    panic!("the server stopped before {message:?}")
                }
            }
        }
    }

    fn signal(&self, name: &str) {
        let status = Command::new("kill")
            .args([format!("-{name}"), self.child.id().to_string()])
            .status()
            .unwrap();
        assert!(status.success());
    }

    fn wait_exit(&mut self, limit: Duration) -> ExitStatus {
        let deadline = Instant::now() + limit;
        loop {
            if let Some(status) = self.child.try_wait().unwrap() {
                return status;
            }
            assert!(Instant::now() < deadline, "the server did not stop");
            std::thread::sleep(Duration::from_millis(50));
        }
    }
}

/// A port that was free a moment ago. `PORT=0` cannot ask the system for a
/// port: like the TypeScript server, the server reads 0 as the default port
/// 3000. Another process can take the port before the server binds it; the
/// test then fails at startup, not silently.
fn free_port() -> u16 {
    TcpListener::bind("0.0.0.0:0")
        .and_then(|listener| listener.local_addr())
        .unwrap()
        .port()
}

fn http_get(port: u16, path: &str) -> String {
    let mut stream = send_request(port, path, false);
    let mut reply = String::new();
    stream.read_to_string(&mut reply).unwrap();
    reply
}

/// Starts the binary, checks the operational routes, sends `signal`, and
/// expects a clean exit.
fn starts_and_stops_on(signal: &str) {
    let port = free_port();
    let mut server = Server::start(port);
    let started = server.wait_for("service started", STARTUP_LIMIT);
    assert_eq!(started["bind"], format!("0.0.0.0:{port}"));

    let health = http_get(port, "/healthz");
    assert!(health.starts_with("HTTP/1.1 200"), "{health}");
    assert!(health.ends_with(r#"{"ok":true}"#), "{health}");
    assert!(
        health
            .to_ascii_lowercase()
            .contains("x-content-type-options: nosniff"),
        "{health}"
    );
    let ready = http_get(port, "/readyz");
    assert!(ready.ends_with(r#"{"ready":true}"#), "{ready}");
    let version = http_get(port, "/version");
    let expected = format!(
        r#"{{"version":"{}","commit":"{COMMIT}"}}"#,
        env!("CARGO_PKG_VERSION")
    );
    assert!(version.ends_with(&expected), "{version}");
    let completed = server.wait_for("request completed", STARTUP_LIMIT);
    assert_eq!(completed["route"], "/healthz");
    assert!(completed["request_id"].is_string(), "{completed}");

    server.signal(signal);
    server.wait_for("shutdown started", IDLE_SHUTDOWN_LIMIT);
    let status = server.wait_exit(IDLE_SHUTDOWN_LIMIT);
    assert!(status.success(), "{status}");
}

#[test]
fn the_binary_starts_and_stops_on_sigterm() {
    starts_and_stops_on("TERM");
}

#[test]
fn the_binary_starts_and_stops_on_sigint() {
    starts_and_stops_on("INT");
}
