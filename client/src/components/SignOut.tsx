import { useMutation, useQueryClient } from '@tanstack/react-query'
import { SIGNED_IN_QUERY_KEYS } from '../modules/signedInQuery'
import { signOut } from '../modules/psnStore'

const SignOut = () => {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: signOut,
    onSuccess: () => {
      for (const queryKey of SIGNED_IN_QUERY_KEYS) {
        void queryClient.resetQueries({ queryKey })
      }
    },
  })

  return (
    <>
      {mutation.isError && (
        <span role="alert" className="sign-out--error">
          Sign-out failed. Try again.
        </span>
      )}
      <button
        type="button"
        className="sign-out"
        disabled={mutation.isPending}
        onClick={() => {
          mutation.mutate()
        }}
      >
        Sign out
      </button>
    </>
  )
}

export default SignOut
