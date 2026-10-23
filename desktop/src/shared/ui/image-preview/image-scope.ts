import { createContext } from "react";
import type { ImageScope } from "../../../../electron/files/image-preview";

export const ImageScopeContext = createContext<ImageScope | undefined>(undefined);
