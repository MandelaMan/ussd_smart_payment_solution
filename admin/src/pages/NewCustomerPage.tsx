import { useNavigate } from "react-router-dom";
import { CustomerForm } from "../components/customers/CustomerForm";

export function NewCustomerPage() {
  const navigate = useNavigate();

  return (
    <CustomerForm
      onCreated={() => {
        navigate("/customers");
      }}
    />
  );
}
