import { Progress } from "@/components/ui/progress";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface DownloadProgressProps {
  title: string;
  progress: number;
}

export function DownloadProgress({ title, progress }: DownloadProgressProps) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <Progress value={progress} />
        <p className="text-xs text-muted-foreground mt-1">
          {Math.round(progress)}% 완료
        </p>
      </CardContent>
    </Card>
  );
}
