import { Box, Grid, Stack, Text } from "@chakra-ui/react";
import type { ReactNode } from "react";

export type FormSummaryItem = {
  label: string;
  value: ReactNode;
};

type Props = {
  title?: string;
  description?: string;
  items: FormSummaryItem[];
};

export function FormSubmitSummary({ title, description, items }: Props) {
  const visible = items.filter(
    (item) => item.value != null && item.value !== "" && item.value !== "—",
  );

  return (
    <Stack gap={3}>
      {title ? (
        <Box>
          <Text fontWeight="semibold" fontSize="sm" color="fg">
            {title}
          </Text>
          {description ? (
            <Text fontSize="xs" color="fg.muted" mt={0.5}>
              {description}
            </Text>
          ) : null}
        </Box>
      ) : null}
      <Box
        borderWidth="1px"
        borderColor="border.muted"
        borderRadius="lg"
        bg="bg.subtle"
        px={4}
        py={3}
      >
        <Grid
          templateColumns={{ base: "1fr", sm: "minmax(120px, 38%) 1fr" }}
          gap={{ base: 1.5, sm: 2 }}
          columnGap={4}
        >
          {visible.map((item) => (
            <Box key={item.label} display="contents">
              <Text fontSize="xs" color="fg.muted" textTransform="uppercase" letterSpacing="0.04em">
                {item.label}
              </Text>
              <Text fontSize="sm" color="fg" fontWeight="medium" wordBreak="break-word">
                {item.value}
              </Text>
            </Box>
          ))}
        </Grid>
      </Box>
    </Stack>
  );
}
