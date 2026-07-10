import { Box, type BoxProps } from "@chakra-ui/react";

type Props = BoxProps & {
  height?: BoxProps["height"];
  width?: BoxProps["width"];
  boxSize?: BoxProps["boxSize"];
};

/** Visible pulse placeholder — does not rely on Chakra skeleton theme tokens */
export function SkeletonBlock({
  height = "16px",
  width,
  boxSize,
  borderRadius = "sm",
  ...rest
}: Props) {
  return (
    <Box
      height={boxSize ? undefined : height}
      width={boxSize ? undefined : width}
      boxSize={boxSize}
      borderRadius={borderRadius}
      bg="gray.200"
      flexShrink={0}
      css={{
        animation: "skeleton-pulse 1.4s ease-in-out infinite",
        "@keyframes skeleton-pulse": {
          "0%, 100%": { opacity: 1 },
          "50%": { opacity: 0.45 },
        },
      }}
      {...rest}
    />
  );
}
