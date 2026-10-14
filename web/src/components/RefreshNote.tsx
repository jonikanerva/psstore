interface RefreshNoteProps {
  failed: boolean
}

// The degraded state of a list view (#164): the view keeps the list that it
// has, and the refresh of that list failed. The note has no role of its own.
// Each view puts it in a status region that is already on the page, because a
// screen reader reliably announces a change to a live region only after the
// region exists (MDN, ARIA live regions).
const RefreshNote = ({ failed }: RefreshNoteProps) =>
  failed ? (
    <p className="refresh-note">
      {"Couldn't refresh. Showing the saved list."}
    </p>
  ) : null

export default RefreshNote
