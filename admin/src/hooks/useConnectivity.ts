import { useEffect, useState } from "react";
import {
  getConnectivityState,
  startConnectivityMonitor,
  subscribeConnectivity,
  type ConnectivityState,
} from "../lib/connectivity";

export function useConnectivity(): ConnectivityState {
  const [state, setState] = useState(getConnectivityState);
  useEffect(() => {
    startConnectivityMonitor();
    return subscribeConnectivity(setState);
  }, []);
  return state;
}
