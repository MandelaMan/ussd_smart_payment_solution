import { useSearchParams } from "react-router-dom";
import { Box, Text } from "@chakra-ui/react";
import { TabStrip } from "../components/ui/TabStrip";
import { ListPageStack } from "../components/ui/pageLayout";
import { MobilePageChrome } from "../components/ui/MobilePageChrome";
import { ListPageStickyChrome } from "../components/ui/ListPageStickyChrome";
import { CustomerWhatsAppChannel } from "../components/communication/CustomerWhatsAppChannel";
import { CustomerEmailChannel } from "../components/communication/CustomerEmailChannel";
import { MOBILE_BOTTOM_NAV_OFFSET } from "../lib/mobileNav";

const SECTIONS = [
  { id: "whatsapp", label: "WhatsApp" },
  { id: "email", label: "Email" },
] as const;

type Section = (typeof SECTIONS)[number]["id"];

/** Viewport height left after mobile page chrome + tabs + bottom nav. */
const CHANNEL_MOBILE_H = `calc(100dvh - 11.25rem - ${MOBILE_BOTTOM_NAV_OFFSET})`;

export function CommunicationPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const sectionParam = searchParams.get("channel");
  const section: Section = sectionParam === "email" ? "email" : "whatsapp";

  function setSection(next: string) {
    const id = next === "email" ? "email" : "whatsapp";
    setSearchParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        if (id === "whatsapp") p.delete("channel");
        else p.set("channel", id);
        return p;
      },
      { replace: true }
    );
  }

  const chrome = (
    <ListPageStickyChrome gap={{ base: 3, lg: 5 }}>
      <MobilePageChrome
        title="Communication"
        description="Message existing customers by WhatsApp or email"
      />
      <TabStrip
        tabs={[...SECTIONS]}
        active={section}
        onChange={setSection}
        fitContent
      />
    </ListPageStickyChrome>
  );

  return (
    <ListPageStack>
      {chrome}
      <Box
        flex={{ lg: 1 }}
        minW={0}
        minH={0}
        h={{ base: CHANNEL_MOBILE_H, lg: "100%" }}
        maxH={{ base: CHANNEL_MOBILE_H, lg: "100%" }}
        display="flex"
        flexDirection="column"
      >
        <Box flex="1" minH={0} display="flex" flexDirection="column">
          {section === "email" ? (
            <CustomerEmailChannel />
          ) : (
            <CustomerWhatsAppChannel />
          )}
        </Box>
        <Text
          fontSize="xs"
          color="fg.muted"
          mt={2}
          flexShrink={0}
          display={{ base: "none", md: "block" }}
        >
          For people who are not customers yet, use Leads → WhatsApp (prospects).
        </Text>
      </Box>
    </ListPageStack>
  );
}
