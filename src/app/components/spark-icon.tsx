// Marks actions that call AI. Decorative: the button text already says what it does.
export function SparkIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={`spark-icon ${className}`.trim()} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path d="M8.5 2.5c.3 2.9 1 4.4 2 5.4s2.6 1.7 5.5 2.1c-2.9.4-4.5 1.1-5.5 2.1s-1.7 2.5-2 5.4c-.3-2.9-1-4.4-2-5.4S3.9 10.4 1 10c2.9-.4 4.5-1.1 5.5-2.1s1.7-2.5 2-5.4Z" />
      <path d="M15.5 1.5c.15 1.25.45 1.9.9 2.35.45.45 1.1.75 2.35.9-1.25.15-1.9.45-2.35.9-.45.45-.75 1.1-.9 2.35-.15-1.25-.45-1.9-.9-2.35-.45-.45-1.1-.75-2.35-.9 1.25-.15 1.9-.45 2.35-.9.45-.45.75-1.1.9-2.35Z" />
    </svg>
  );
}
