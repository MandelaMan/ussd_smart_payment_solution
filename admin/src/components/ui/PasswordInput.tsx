import { IconButton, Input, InputGroup, type InputProps } from "@chakra-ui/react";
import { useState } from "react";
import { FiEye, FiEyeOff } from "react-icons/fi";

export function PasswordInput(props: Omit<InputProps, "type">) {
  const [visible, setVisible] = useState(false);

  return (
    <InputGroup
      endElement={
        <IconButton
          type="button"
          aria-label={visible ? "Hide password" : "Show password"}
          variant="ghost"
          size="xs"
          color="fg.muted"
          _hover={{ color: "fg", bg: "transparent" }}
          onClick={() => setVisible((v) => !v)}
          tabIndex={-1}
        >
          {visible ? <FiEyeOff size={16} /> : <FiEye size={16} />}
        </IconButton>
      }
    >
      <Input type={visible ? "text" : "password"} {...props} />
    </InputGroup>
  );
}
