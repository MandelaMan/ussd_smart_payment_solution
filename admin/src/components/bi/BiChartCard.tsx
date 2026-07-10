import { Box, Flex, IconButton, Menu, Text } from "@chakra-ui/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  FiDownload,
  FiMaximize2,
  FiMinimize2,
  FiMoreVertical,
  FiPrinter,
} from "react-icons/fi";
import { ChartSkeleton } from "../PageSkeletons";
import { BRAND } from "../../theme";

type ExportSection =
  | "revenueByPackage"
  | "salesLeaderboard"
  | "geographic"
  | "monthlyRevenue";

type Props = {
  title: string;
  subtitle?: string;
  children?: ReactNode;
  minH?: string;
  exportSection?: ExportSection;
  onExportCsv?: (section: ExportSection) => void;
  onPrint?: () => void;
  empty?: boolean;
  emptyMessage?: string;
};

export function BiChartCard({
  title,
  subtitle,
  children,
  minH = "280px",
  exportSection,
  onExportCsv,
  onPrint,
  empty,
  emptyMessage = "No data for the selected filters.",
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setVisible(true);
      },
      { rootMargin: "120px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const handlePrint = () => {
    if (onPrint) {
      onPrint();
      return;
    }
    window.print();
  };

  const card = (
    <Box
      ref={rootRef}
      bg="white"
      border="1px solid"
      borderColor="gray.100"
      borderRadius="lg"
      borderTopWidth="3px"
      borderTopColor={BRAND.cerulean}
      p={4}
      boxShadow="sm"
      h={fullscreen ? "100%" : undefined}
      className={fullscreen ? "bi-chart-fullscreen" : undefined}
    >
      <Flex align="flex-start" justify="space-between" gap={2} mb={3}>
        <Box>
          <Text fontSize="sm" fontWeight="semibold" color="gray.800">
            {title}
          </Text>
          {subtitle && (
            <Text fontSize="xs" color="gray.500" mt={0.5}>
              {subtitle}
            </Text>
          )}
        </Box>
        <Flex gap={1}>
          <IconButton
            aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen"}
            size="xs"
            variant="ghost"
            onClick={() => setFullscreen((v) => !v)}
          >
            {fullscreen ? <FiMinimize2 /> : <FiMaximize2 />}
          </IconButton>
          <Menu.Root>
            <Menu.Trigger asChild>
              <IconButton aria-label="Chart actions" size="xs" variant="ghost">
                <FiMoreVertical />
              </IconButton>
            </Menu.Trigger>
            <Menu.Positioner>
              <Menu.Content>
                {exportSection && onExportCsv && (
                  <Menu.Item
                    value="csv"
                    onClick={() => onExportCsv(exportSection)}
                  >
                    <FiDownload />
                    Export CSV
                  </Menu.Item>
                )}
                <Menu.Item value="print" onClick={handlePrint}>
                  <FiPrinter />
                  Print
                </Menu.Item>
              </Menu.Content>
            </Menu.Positioner>
          </Menu.Root>
        </Flex>
      </Flex>

      <Box minH={minH}>
        {empty ? (
          <Flex h="100%" minH={minH} align="center" justify="center">
            <Text fontSize="sm" color="gray.400" textAlign="center" px={4}>
              {emptyMessage}
            </Text>
          </Flex>
        ) : visible ? (
          children
        ) : (
          <ChartSkeleton height={minH} />
        )}
      </Box>
    </Box>
  );

  if (!fullscreen) return card;

  return (
    <Box
      position="fixed"
      inset={0}
      zIndex={1400}
      bg="white"
      p={4}
      overflow="auto"
    >
      {card}
    </Box>
  );
}
