FROM nginx

ENV NGINX_PORT 8080

COPY build /usr/share/nginx/html
