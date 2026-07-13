import { createSystem, defaultConfig, defineConfig } from "@chakra-ui/react";

/** Official SUL brand palette */
export const BRAND = {
  cerulean: "#166a82",
  paleAzure: "#6dcff6",
  mindaro: "#eaeeab",
  sandyBrown: "#f9a456",
} as const;

/** Shared border + shadow for text fields, selects, and composite input shells. */
export const fieldControlStyles = {
  borderRadius: "md",
  bg: "bg.panel",
  boxShadow: "sm",
  _disabled: {
    bg: "bg.muted",
    opacity: 1,
  },
} as const;

/** Uniform height for filter toolbar inputs and selects. */
export const FILTER_CONTROL_HEIGHT = "36px";

const fieldOutlineVariant = {
  bg: "bg.panel",
  borderWidth: "1px",
  borderColor: "border",
  boxShadow: "sm",
  focusRingWidth: "0px",
  _focusVisible: {
    borderColor: "brand.500",
    boxShadow: "0 0 0 1px var(--chakra-colors-brand-500)",
    outline: "none",
  },
} as const;

/** Neutralize themed borders on inputs rendered inside a composite field shell. */
export const embeddedFieldInputStyles = {
  bg: "transparent",
  borderWidth: 0,
  borderColor: "transparent",
  boxShadow: "none",
  borderRadius: 0,
  focusRingWidth: "0px",
  _focus: {
    boxShadow: "none",
    outline: "none",
    borderWidth: 0,
  },
  _focusVisible: {
    boxShadow: "none",
    outline: "none",
    borderWidth: 0,
  },
} as const;

const config = defineConfig({
  theme: {
    tokens: {
      colors: {
        brand: {
          50: { value: "#e6f3f7" },
          100: { value: "#c5e4ef" },
          200: { value: "#9fd4e8" },
          300: { value: "#6dcff6" },
          400: { value: "#3ba8c4" },
          500: { value: "#1a7a94" },
          600: { value: "#166a82" },
          700: { value: "#12596d" },
          800: { value: "#0e4858" },
          900: { value: "#0a3744" },
        },
        azure: {
          400: { value: "#8dd9f8" },
          500: { value: "#6dcff6" },
        },
        mindaro: {
          400: { value: "#f2f5c4" },
          500: { value: "#eaeeab" },
        },
        sandy: {
          400: { value: "#fbb878" },
          500: { value: "#f9a456" },
        },
        surface: {
          50: { value: "#f4f6f7" },
          100: { value: "#eceef1" },
          900: { value: "#0b1220" },
          950: { value: "#070b14" },
        },
      },
      fonts: {
        heading: {
          value:
            "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        },
        body: {
          value:
            "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        },
      },
      fontSizes: {
        "2xs": { value: "0.65625rem" },
        xs: { value: "0.78125rem" },
        sm: { value: "0.90625rem" },
        md: { value: "0.96875rem" },
        lg: { value: "1.09375rem" },
        xl: { value: "1.28125rem" },
        "2xl": { value: "1.53125rem" },
      },
      radii: {
        none: { value: "0" },
        "2xs": { value: "1px" },
        xs: { value: "2px" },
        sm: { value: "3px" },
        md: { value: "4px" },
        lg: { value: "6px" },
        xl: { value: "8px" },
        "2xl": { value: "10px" },
        "3xl": { value: "12px" },
        full: { value: "9999px" },
      },
    },
    semanticTokens: {
      colors: {
        bg: {
          DEFAULT: { value: { base: "{colors.surface.50}" } },
          subtle: { value: { base: "{colors.surface.50}" } },
          muted: { value: { base: "{colors.gray.100}" } },
          emphasized: { value: { base: "{colors.gray.200}" } },
          panel: { value: { base: "{colors.white}" } },
        },
        fg: {
          DEFAULT: { value: { base: "{colors.gray.800}" } },
          muted: { value: { base: "{colors.gray.600}" } },
          subtle: { value: { base: "{colors.gray.400}" } },
        },
        border: {
          DEFAULT: { value: { base: "{colors.gray.200}" } },
          muted: { value: { base: "{colors.gray.100}" } },
        },
        card: { value: { base: "{colors.white}" } },
        "header.bg": { value: { base: "{colors.brand.600}" } },
        "header.fg": { value: { base: "white" } },
        "sidebar.bg": { value: { base: "{colors.white}" } },
        "sidebar.nav": { value: { base: "{colors.brand.50}" } },
        "sidebar.border": { value: { base: "{colors.brand.100}" } },
        "sidebar.fg": { value: { base: "{colors.brand.800}" } },
        "sidebar.hover": { value: { base: "{colors.white}" } },
        "sidebar.muted": { value: { base: "{colors.gray.500}" } },
      },
    },
    recipes: {
      button: {
        base: {
          fontWeight: "semibold",
          borderRadius: "sm",
        },
        defaultVariants: {
          variant: "solid",
        },
        variants: {
          variant: {
            solid: {
              bg: "brand.600",
              color: "white",
              _hover: { bg: "brand.700" },
              _active: { bg: "brand.800" },
            },
            outline: {
              borderColor: "brand.600",
              color: "brand.700",
              _hover: {
                bg: "brand.50",
                borderColor: "brand.700",
              },
            },
            ghost: {
              color: "brand.700",
              _hover: {
                bg: "brand.50",
              },
            },
            subtle: {
              bg: "brand.50",
              color: "brand.700",
              _hover: {
                bg: "brand.100",
              },
            },
          },
        },
      },
      input: {
        base: fieldControlStyles,
        variants: {
          variant: {
            outline: fieldOutlineVariant,
          },
        },
      },
      textarea: {
        base: fieldControlStyles,
        variants: {
          variant: {
            outline: fieldOutlineVariant,
          },
        },
      },
      iconButton: {
        base: {
          borderRadius: "sm",
        },
      },
      badge: {
        base: {
          borderRadius: "sm",
        },
      },
    },
    slotRecipes: {
      nativeSelect: {
        slots: ["root", "indicator", "field"],
        base: {
          field: fieldControlStyles,
        },
        variants: {
          variant: {
            outline: {
              field: fieldOutlineVariant,
            },
          },
        },
      },
      select: {
        slots: [
          "root",
          "item",
          "itemIndicator",
          "positioner",
          "content",
          "indicator",
          "list",
          "control",
          "label",
          "trigger",
          "valueText",
          "clearTrigger",
          "indicatorGroup",
          "itemGroup",
          "itemGroupLabel",
          "itemText",
        ],
        variants: {
          variant: {
            outline: {
              trigger: fieldOutlineVariant,
            },
          },
        },
      },
    },
  },
  globalCss: {
    "html, body": {
      fontFamily: "body",
      fontSize: "md",
      lineHeight: "1.45",
      color: "fg",
      background: "bg",
    },
    "#root": {
      minHeight: "100dvh",
      background: "bg",
      color: "fg",
    },
  },
});

export const system = createSystem(defaultConfig, config);
