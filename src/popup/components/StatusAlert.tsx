import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { CheckCircle, AlertCircle, Info } from "lucide-react";

interface StatusAlertProps {
  status: "success" | "error" | "info";
  title: string;
  description?: string;
}

const icons = {
  success: CheckCircle,
  error: AlertCircle,
  info: Info,
};

export function StatusAlert({ status, title, description }: StatusAlertProps) {
  const Icon = icons[status];

  return (
    <Alert variant={status === "error" ? "destructive" : "default"}>
      <Icon className="h-4 w-4" />
      <AlertTitle>{title}</AlertTitle>
      {description && <AlertDescription>{description}</AlertDescription>}
    </Alert>
  );
}
