import { config } from "../../config";
import { compatStt } from "../openaiCompat";

export const openaiStt = compatStt(() => ({ apiKey: config.openaiKey }));
