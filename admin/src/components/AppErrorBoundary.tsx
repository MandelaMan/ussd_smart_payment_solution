import { Component, type ErrorInfo, type ReactNode } from "react";
import { Box, Button, Heading, Stack, Text } from "@chakra-ui/react";

type Props = { children: ReactNode };
type State = { error: Error | null };

/**
 * Prevents a single route/render crash from wiping the entire admin shell.
 */
export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[admin] render crash:", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <Box minH="100vh" display="flex" alignItems="center" justifyContent="center" p={6}>
        <Stack gap={3} maxW="28rem" textAlign="center">
          <Heading size="md">Something went wrong</Heading>
          <Text fontSize="sm" color="fg.muted">
            {this.state.error.message || "The admin UI hit an unexpected error."}
          </Text>
          <Button
            colorPalette="brand"
            onClick={() => {
              this.setState({ error: null });
              window.location.assign(`${import.meta.env.BASE_URL}`);
            }}
          >
            Reload admin
          </Button>
        </Stack>
      </Box>
    );
  }
}
