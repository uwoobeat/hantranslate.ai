import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

interface TranslateButtonProps {
  isLoading: boolean;
  onClick: () => void;
  disabled?: boolean;
}

export function TranslateButton({
  isLoading,
  onClick,
  disabled,
}: TranslateButtonProps) {
  return (
    <Button
      onClick={onClick}
      disabled={disabled || isLoading}
      className="w-full"
    >
      {isLoading ? (
        <>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          번역 중...
        </>
      ) : (
        "번역 시작"
      )}
    </Button>
  );
}
