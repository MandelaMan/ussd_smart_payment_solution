import { Component, type ErrorInfo, type ReactNode } from "react";
import { Box, Button, Heading, Stack, Text } from "@chakra-ui/react";

type Props = { children: ReactNode };
type State = { error: Error | null };

const STALE_IMPORT_RE =
  /dynamically imported module|Failed to fetch dynamically imported module|Loading chunk/i;
const STALE_IMPORT_RELOAD_KEY = "sul-admin-stale-import-reload";

function isStaleDynamicImportError(error: Error | null) {
  if (!error) return false;
  return STALE_IMPORT_RE.test(error.message || "");
}

function shouldReloadForStaleImport() {
  try {
    if (sessionStorage.getItem(STALE_IMPORT_RELOAD_KEY)) return false;
    sessionStorage.setItem(STALE_IMPORT_RELOAD_KEY, "1");
    return true;
  } catch {
    return false;
  }
}

function clearStaleImportReload() {
  try {
    sessionStorage.removeItem(STALE_IMPORT_RELOAD_KEY);
  } catch {
    /* private mode */
  }
}

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
    if (isStaleDynamicImportError(error) && shouldReloadForStaleImport()) {
      window.location.reload();
    }
  }

  componentDidMount() {
    if (!this.state.error) clearStaleImportReload();
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
              clearStaleImportReload();
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
