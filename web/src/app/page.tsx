import PickupClient from "./PickupClient";
import { loadPickupData } from "@/lib/pickupData";

export default async function Home() {
  const data = await loadPickupData();
  return <PickupClient {...data} mode="pullback" />;
}
