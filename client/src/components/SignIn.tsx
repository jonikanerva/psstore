import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { PURCHASED_QUERY_KEY } from '../modules/purchasedQuery'
import { HttpError, signIn } from '../modules/psnStore'

const PLAYSTATION_URL = 'https://www.playstation.com/'
const NPSSO_URL = 'https://ca.account.sony.com/api/v1/ssocookie'

const errorMessage = (error: unknown): string =>
  error instanceof HttpError && (error.status === 400 || error.status === 401)
    ? 'Sign-in failed. Check the token.'
    : 'Sony sign-in is unavailable. Try again later.'

const SignIn = () => {
  const queryClient = useQueryClient()
  const [token, setToken] = useState('')
  const mutation = useMutation({
    mutationFn: signIn,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: PURCHASED_QUERY_KEY }),
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
      <p className="sign-in--help">
        The NPSSO token is a full account credential. It is sent once. The
        sign-in stays for 30 days until you sign out.
      </p>
      <ol className="sign-in--steps">
        <li>
          Sign in at{' '}
          <a href={PLAYSTATION_URL} target="_blank" rel="noopener noreferrer">
            playstation.com
          </a>{' '}
          in this browser.
        </li>
        <li>
          Open{' '}
          <a href={NPSSO_URL} target="_blank" rel="noopener noreferrer">
            Get your NPSSO token
          </a>
          .
        </li>
        <li>Copy the value of npsso and paste it above.</li>
      </ol>
    </form>
  )
}

export default SignIn
