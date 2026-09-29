export default function JournalLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div
        className="h-7 w-7 animate-spin rounded-full border-2 border-primary/30 border-t-primary"
        role="status"
        aria-label="Loading"
      />
    </div>
  );
}
