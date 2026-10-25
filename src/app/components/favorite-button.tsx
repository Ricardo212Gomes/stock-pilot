"use client";

import { useState, useTransition } from "react";
import { signInFromAction, toggleFavoriteAction } from "../favorites/actions";

function StarIcon({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" fill={filled ? "currentColor" : "none"}>
      <path d="m10 2.8 2.2 4.6 5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5L2.8 8.1l5-.7L10 2.8Z" />
    </svg>
  );
}

// A star that saves the ticker to the signed-in user's favorites, or offers to sign in.
export function FavoriteButton({
  symbol,
  initial,
  signedIn,
  compact = false,
}: {
  symbol: string;
  initial: boolean;
  signedIn: boolean;
  compact?: boolean;
}) {
  const [favorite, setFavorite] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const label = !signedIn
    ? `Sign in to add ${symbol} to favorites`
    : favorite ? `Remove ${symbol} from favorites` : `Add ${symbol} to favorites`;

  function onClick() {
    setError(null);
    startTransition(async () => {
      if (!signedIn) {
        await signInFromAction(`${window.location.pathname}${window.location.search}`);
        return;
      }
      // Show the change straight away; undo it if the server refuses.
      setFavorite(!favorite);
      const result = await toggleFavoriteAction(symbol);
      if (!result.ok) {
        setFavorite(favorite);
        setError(result.error);
      } else {
        setFavorite(result.favorite);
      }
    });
  }

  return (
    <span className="favorite-control">
      <button
        type="button"
        className={`favorite-button${favorite ? " favorite-button-on" : ""}${compact ? " favorite-button-compact" : ""}`}
        onClick={onClick}
        disabled={pending}
        aria-pressed={signedIn ? favorite : undefined}
        aria-label={label}
        title={label}
      >
        <StarIcon filled={favorite} />
        {!compact && <span>{favorite ? "Favorite" : "Add to favorites"}</span>}
      </button>
      {error && <span className="favorite-error" role="alert">{error}</span>}
    </span>
  );
}
