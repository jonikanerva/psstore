import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { SIGNED_IN_QUERY_KEYS } from '../modules/signedInQuery'
import { HttpError, signIn } from '../modules/psnStore'

const PLAYSTATION_URL = 'https://www.playstation.com/'
const NPSSO_URL = 'https://ca.account.sony.com/api/v1/ssocookie'

const errorMessage = (error: unknown): string =>
  error instanceof HttpError && (error.status === 400 || error.status === 401)
    ? 'Sign-in failed. Check the token.'
    : 'Sony sign-in is unavailable. Try again later.'

interface SignInProps {
  readonly queryKey: readonly unknown[]
}

const SignIn = ({ queryKey }: SignInProps) => {
  const queryClient = useQueryClient()
  const [token, setToken] = useState('')
  const mutation = useMutation({
    mutationFn: signIn,
    onSuccess: () => {
      // The other signed-in lists reset instead of refetching: a reset
      // refetches only a list that is on screen, so no hidden Sony call.
      for (const key of SIGNED_IN_QUERY_KEYS) {
        if (key[0] !== queryKey[0]) {
          void queryClient.resetQueries({ queryKey: key })
        }
      }
      return queryClient.invalidateQueries({ queryKey })
    },
  })

  const submit = () => {
    const value = token.trim()
    // The token never stays in the field, whatever the outcome.
    setToken('')
    if (value !== '') {
      mutation.mutate(value)
    }
  }

  return (
    <form
      className="sign-in"
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
      aria-busy={mutation.isPending}
    >
      <label htmlFor="npsso" className="sign-in--label">
        NPSSO token
      </label>
      <input
        id="npsso"
        name="npsso"
        type="password"
        autoComplete="off"
        spellCheck={false}
        className="sign-in--input"
        value={token}
        disabled={mutation.isPending}
        onChange={(event) => {
          setToken(event.currentTarget.value)
        }}
      />
      <button
        type="submit"
        className="sign-in--button"
        disabled={mutation.isPending}
      >
        Sign in
      </button>
      {mutation.isError && (
        <p role="alert" className="sign-in--error">
          {errorMessage(mutation.error)}
        </p>
      )}
      <ol className="sign-in--steps">
        <li>
          Make sure you are signed in to{' '}
          <a href={PLAYSTATION_URL} target="_blank" rel="noopener noreferrer">
            playstation.com
          </a>
          .
        </li>
        <li>
          <a href={NPSSO_URL} target="_blank" rel="noopener noreferrer">
            Get your token here
          </a>{' '}
          and copy it.
        </li>
        <li>Paste it above and click Sign in.</li>
      </ol>
    </form>
  )
}

export default SignIn
