import { cn } from "@/lib/utils";

interface SpacerProps extends React.HTMLAttributes<HTMLDivElement> {
  orientation?: "horizontal" | "vertical";
  size?: string | number;
}

function Spacer({
  orientation = "horizontal",
  size,
  className,
  style,
  ...props
}: SpacerProps) {
  return (
    <div
      data-slot="spacer"
      className={cn(!size && "flex-1", className)}
      style={{
        ...style,
        ...(size && {
          width: orientation === "vertical" ? "1px" : size,
          height: orientation === "horizontal" ? "1px" : size,
        }),
      }}
      {...props}
    />
  );
}

export type { SpacerProps };
export { Spacer };
