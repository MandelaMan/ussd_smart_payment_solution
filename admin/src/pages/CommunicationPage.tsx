import { useSearchParams } from "react-router-dom";
import { Box, Text } from "@chakra-ui/react";
import { TabStrip } from "../components/ui/TabStrip";
import { ListPageStack } from "../components/ui/pageLayout";
import { MobilePageChrome } from "../components/ui/MobilePageChrome";
import { ListPageStickyChrome, ListPageTableSection } from "../components/ui/ListPageStickyChrome";
import { CustomerWhatsAppChannel } from "../components/communication/CustomerWhatsAppChannel";
import { CustomerEmailChannel } from "../components/communication/CustomerEmailChannel";

const SECTIONS = [
  { id: "whatsapp", label: "WhatsApp" },
  { id: "email", label: "Email" },
] as const;

type Section = (typeof SECTIONS)[number]["id"];

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

  return (
    <ListPageStack>
      <ListPageTableSection
        chrome={
          <ListPageStickyChrome gap={{ base: 4, lg: 5 }}>
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
        }
      >
        <Box pt={{ base: 2, lg: 3 }}>
          {section === "email" ? (
            <CustomerEmailChannel />
          ) : (
            <CustomerWhatsAppChannel />
          )}
          <Text fontSize="xs" color="fg.muted" mt={3}>
            For people who are not customers yet, use Leads → WhatsApp (prospects).
          </Text>
        </Box>
      </ListPageTableSection>
    </ListPageStack>
  );
}
