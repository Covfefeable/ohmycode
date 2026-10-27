import { createContext } from "react";
import type { ImageScope } from "../../../../contracts/domain";

export const ImageScopeContext = createContext<ImageScope | undefined>(undefined);
