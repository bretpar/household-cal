import { Eye, EyeOff } from "lucide-react";

type PasswordRevealToggleProps = {
  revealed: boolean;
  onToggle: () => void;
};

export function PasswordRevealToggle({ revealed, onToggle }: PasswordRevealToggleProps) {
  return (
    <button
      type="button"
      tabIndex={-1}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onToggle}
      aria-label={revealed ? "Hide password" : "Show password"}
      className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-muted-foreground"
    >
      {revealed ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
    </button>
  );
}
