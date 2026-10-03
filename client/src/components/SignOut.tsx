import { useMutation, useQueryClient } from '@tanstack/react-query'
import { PURCHASED_QUERY_KEY } from '../modules/purchasedQuery'
import { signOut } from '../modules/psnStore'

const SignOut = () => {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: signOut,
    onSuccess: () => {
      void queryClient.resetQueries({ queryKey: PURCHASED_QUERY_KEY })
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
