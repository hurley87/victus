import { sdk as miniappSdk } from "@farcaster/miniapp-sdk";
import {
  createContext,
  type ReactNode,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";

type EnvironmentContextType = {
  isInBrowser: boolean;
  isInFarcasterMiniApp: boolean;
  isLoading: boolean;
};

const EnvironmentContext = createContext<EnvironmentContextType | undefined>(
  undefined
);

export const useEnvironment = () => {
  const context = useContext(EnvironmentContext);
  if (!context) {
    throw new Error(
      "useEnvironment must be used within an EnvironmentProvider"
    );
  }
  return context;
};

type EnvironmentProviderProps = {
  children: ReactNode;
};

export const EnvironmentProvider = ({ children }: EnvironmentProviderProps) => {
  const [isInFarcasterMiniApp, setIsInFarcasterMiniApp] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isInBrowser, setIsInBrowser] = useState(false);

  useLayoutEffect(() => {
    const checkEnvironment = async () => {
      try {
        const inMiniApp = await miniappSdk.isInMiniApp();
        setIsInFarcasterMiniApp(inMiniApp);
        setIsInBrowser(!inMiniApp);
      } catch (_error) {
        setIsInFarcasterMiniApp(false);
        setIsInBrowser(true);
      } finally {
        setIsLoading(false);
      }
    };

    checkEnvironment();
  }, []);

  const value = useMemo<EnvironmentContextType>(
    () => ({
      isInFarcasterMiniApp,
      isLoading,
      isInBrowser,
    }),
    [isInFarcasterMiniApp, isLoading, isInBrowser],
  );

  return (
    <EnvironmentContext.Provider value={value}>
      {children}
    </EnvironmentContext.Provider>
  );
};
