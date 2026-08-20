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

  componentDidMount() {
    if (import.meta.hot) {
      import.meta.hot.on("vite:afterUpdate", this.clearError);
    }
  }

  componentWillUnmount() {
    import.meta.hot?.off("vite:afterUpdate", this.clearError);
  }

  clearError = () => {
    if (this.state.error) this.setState({ error: null });
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <Box
        minH="100vh"
        display="flex"
        alignItems="center"
        justifyContent="center"
        p={6}
        bg="white"
      >
        <Stack gap={3} maxW="28rem" textAlign="center">
          <Heading size="md">Something went wrong</Heading>
          <Text fontSize="sm" color="fg.muted">
            {this.state.error.message || "The admin UI hit an unexpected error."}
          </Text>
          <Text fontSize="xs" color="fg.subtle">
            If this followed a live reload, a full page refresh usually clears it.
          </Text>
          <Button
            colorPalette="brand"
            onClick={() => {
              this.setState({ error: null });
              window.location.reload();
            }}
          >
            Reload admin
          </Button>
        </Stack>
      </Box>
    );
  }
}
