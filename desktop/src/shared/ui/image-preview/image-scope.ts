import { createContext } from "react";
import type { ImageScope } from "../../../../electron/runtime/image-preview";

export const ImageScopeContext = createContext<ImageScope | undefined>(undefined);
