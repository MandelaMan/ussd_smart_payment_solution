import { Box, Button, Flex, Text } from "@chakra-ui/react";
import { FiEdit2, FiPackage } from "react-icons/fi";
import { formatCurrency, splitVatInclusive, type Product } from "../../lib/api";
import { formatTitleCase } from "../../lib/formatText";
import { EntityExpandShell, StatusPill } from "../module/EntityExpandShell";

type Props = {
  product: Product;
  onEdit: (product: Product) => void;
  canEdit?: boolean;
};

function periodPriceLabel(frequency: Product["paymentFrequency"]) {
  switch (frequency) {
    case "quarterly":
      return "Quarterly price";
    case "yearly":
      return "Yearly price";
    default:
      return "Monthly price";
  }
}

export function ProductExpandPanel({ product, onEdit, canEdit = true }: Props) {
  const { exclVat, vat } = splitVatInclusive(product.price);
  const extraBandwidth = Number(product.extraBandwidth || 0);
  const totalBandwidth = Number(product.mbps || 0) + extraBandwidth;
  const showMonthlyEquivalent =
    product.paymentFrequency !== "monthly" &&
    Number(product.monthlyPrice) !== Number(product.price);

  const extras: string[] = [];
  if (product.hasDstv) extras.push("Includes DSTV");
  if (product.requiresDecoderFee) {
    extras.push(
      `Decoder fee ${formatCurrency(product.decoderFeeAmount || 2900)} (signup)`
    );
  }

  return (
    <EntityExpandShell
      icon={FiPackage}
      title={
        product.planName
          ? `${formatTitleCase(product.planName)} · ${formatTitleCase(product.categoryName)}`
          : formatTitleCase(product.name)
      }
      subtitle={`${formatTitleCase(product.buildingName)} · ${totalBandwidth} Mbps${
        extraBandwidth > 0 ? ` (${product.mbps} + ${extraBandwidth} extra bandwidth)` : ""
      } · ${formatTitleCase(product.paymentFrequency)}`}
      value={
        canEdit ? (
          <Button size="sm" variant="outline" onClick={() => onEdit(product)}>
            <FiEdit2 />
            Edit price
          </Button>
        ) : undefined
      }
      status={
        <StatusPill
          label={product.isActive ? "Active" : "Inactive"}
          colorPalette={product.isActive ? "green" : "gray"}
        />
      }
      accent="teal.600"
    >
      <Flex direction={{ base: "column", md: "row" }} gap={{ base: 1.5, md: 3 }} align="stretch" w="full">
        <Box
          flex={1}
          bg="brand.50"
          border="1px solid"
          borderColor="brand.100"
          borderRadius="md"
          px={{ base: 2.5, md: 4 }}
          py={{ base: 2, md: 3 }}
          minW={0}
        >
          <Text
            fontSize="2xs"
            fontWeight="semibold"
            color="fg.muted"
            textTransform="uppercase"
            letterSpacing="0.04em"
            mb={0.5}
          >
            {periodPriceLabel(product.paymentFrequency)} (incl. VAT)
          </Text>
          <Text fontSize={{ base: "lg", md: "xl" }} fontWeight="bold" color="fg" lineHeight="1.2">
            {formatCurrency(product.price)}
          </Text>
          <Text fontSize={{ base: "xs", md: "sm" }} color="fg.muted" mt={1}>
            {formatCurrency(exclVat)} excl. VAT · {formatCurrency(vat)} VAT (16%)
          </Text>
          {showMonthlyEquivalent && (
            <Text fontSize={{ base: "xs", md: "sm" }} color="fg.muted" mt={1.5}>
              ≈ {formatCurrency(product.monthlyPrice)}/month incl. VAT
            </Text>
          )}
        </Box>

        {extras.length > 0 && (
          <Box
            bg="bg.subtle"
            border="1px solid"
            borderColor="border.muted"
            borderRadius="md"
            px={{ base: 2.5, md: 4 }}
            py={{ base: 2, md: 3 }}
            minW={{ md: "200px" }}
            w={{ base: "full", md: "auto" }}
            display="flex"
            flexDirection="column"
            justifyContent="center"
            gap={1}
          >
            <Text
              fontSize="2xs"
              fontWeight="semibold"
              color="fg.muted"
              textTransform="uppercase"
              letterSpacing="0.04em"
            >
              Add-ons
            </Text>
            {extras.map((line) => (
              <Text key={line} fontSize="sm" fontWeight="medium" color="fg">
                {line}
              </Text>
            ))}
          </Box>
        )}
      </Flex>
    </EntityExpandShell>
  );
}
