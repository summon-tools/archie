export default function NotFound() {
  return (
    <div className="h-screen flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-4xl font-bold text-th-primary mb-2">404</h1>
        <p className="text-sm text-th-muted mb-4">Page not found</p>
        <a href="/" className="text-sm text-th-muted hover:text-th-primary font-medium">
          Back to Dashboard
        </a>
      </div>
    </div>
  );
}
