import PickupClient from "../PickupClient";
import { loadPickupData } from "@/lib/pickupData";

export default async function StophighPage() {
  const data = await loadPickupData();
  return <PickupClient {...data} mode="stophigh" />;
}
