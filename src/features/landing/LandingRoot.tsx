import { completeRegistryCounts } from "../../shared/api/surfaceReadState";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchProofApiJson,
  isTransientProofApiReadError,
  proofApiLastGoodReadStatus,
} from "../../shared/api/proofApiClient";
import {
  dnsRegistryAddressForNetwork,
  registryAddressForNetwork,
} from "../../shared/protocol/idRegistry";
import { LandingApp } from "./LandingApp";

type RegistryCounts = {
  confirmedCount: number;
  pendingCount: number;
  totalCount: number;
};

type RegistrySummaryResponse = {
  indexedAt?: string;
  registryCounts?: {
    model?: string;
    complete?: boolean;
    confirmedCount?: number;
    pendingCount?: number;
    totalCount?: number;
  };
};

const EMPTY_REGISTRY_COUNTS: RegistryCounts = {
  confirmedCount: 0,
  pendingCount: 0,
  totalCount: 0,
};

function summaryCountsPath(basePath: string, fresh: boolean) {
  const params = new URLSearchParams({ projection: "counts-v1" });
  if (fresh) {
    params.set("fresh", "1");
  }
  return `${basePath}?${params.toString()}`;
}

async function fetchRegistryCountsSummary(
  basePath: string,
  fresh: boolean,
  signal: AbortSignal,
  label: string,
) {
  const payload = await fetchProofApiJson<RegistrySummaryResponse>(
    summaryCountsPath(basePath, fresh),
    "livenet",
    { signal },
  );
  return {
    counts: completeRegistryCounts(payload, label),
    indexedAt:
      typeof payload.indexedAt === "string" ? payload.indexedAt : undefined,
  };
}

export default function LandingRoot() {
  const [registryCounts, setRegistryCounts] = useState(EMPTY_REGISTRY_COUNTS);
  const [dnsRegistryCounts, setDnsRegistryCounts] =
    useState(EMPTY_REGISTRY_COUNTS);
  const [registryLoaded, setRegistryLoaded] = useState(false);
  const [dnsRegistryLoaded, setDnsRegistryLoaded] = useState(false);
  const [registryLoading, setRegistryLoading] = useState(false);
  const [registryFresh, setRegistryFresh] = useState(false);
  const [dnsRegistryFresh, setDnsRegistryFresh] = useState(false);
  const [registryError, setRegistryError] = useState("");
  const [dnsRegistryError, setDnsRegistryError] = useState("");
  const [registryWarning, setRegistryWarning] = useState("");
  const [dnsRegistryWarning, setDnsRegistryWarning] = useState("");
  const requestGenerationRef = useRef(0);
  const requestControllerRef = useRef<AbortController>();
  const lastGoodRegistryRef = useRef<{ indexedAt?: string; loaded: boolean }>({
    loaded: false,
  });
  const lastGoodDnsRegistryRef = useRef<{ indexedAt?: string; loaded: boolean }>(
    {
      loaded: false,
    },
  );

  const refreshRegistries = useCallback(async (fresh = false) => {
    const generation = ++requestGenerationRef.current;
    requestControllerRef.current?.abort();
    const controller = new AbortController();
    requestControllerRef.current = controller;
    setRegistryLoading(true);
    setRegistryError("");
    setDnsRegistryError("");

    try {
      const [idResult, dnsResult] = await Promise.allSettled([
        fetchRegistryCountsSummary(
          "/api/v1/registry-summary",
          fresh,
          controller.signal,
          "ProofOfWork ID registry",
        ),
        fetchRegistryCountsSummary(
          "/api/v1/dns-summary",
          fresh,
          controller.signal,
          "ProofOfWork DNS registry",
        ),
      ]);
      if (generation !== requestGenerationRef.current) {
        return false;
      }

      let fullyLoaded = true;
      if (idResult.status === "fulfilled") {
        setRegistryCounts(idResult.value.counts);
        setRegistryLoaded(true);
        setRegistryFresh(fresh);
        setRegistryWarning("");
        lastGoodRegistryRef.current = {
          indexedAt: idResult.value.indexedAt,
          loaded: true,
        };
      } else {
        fullyLoaded = false;
        if (
          fresh &&
          lastGoodRegistryRef.current.loaded &&
          isTransientProofApiReadError(idResult.reason)
        ) {
          setRegistryWarning(
            proofApiLastGoodReadStatus(idResult.reason, {
              indexedAt: lastGoodRegistryRef.current.indexedAt,
              label: "ProofOfWork ID registry",
            }),
          );
        } else {
          setRegistryError(
            idResult.reason instanceof Error
              ? idResult.reason.message
              : "ProofOfWork ID registry summary is unavailable.",
          );
        }
      }

      if (dnsResult.status === "fulfilled") {
        setDnsRegistryCounts(dnsResult.value.counts);
        setDnsRegistryLoaded(true);
        setDnsRegistryFresh(fresh);
        setDnsRegistryWarning("");
        lastGoodDnsRegistryRef.current = {
          indexedAt: dnsResult.value.indexedAt,
          loaded: true,
        };
      } else {
        fullyLoaded = false;
        if (
          fresh &&
          lastGoodDnsRegistryRef.current.loaded &&
          isTransientProofApiReadError(dnsResult.reason)
        ) {
          setDnsRegistryWarning(
            proofApiLastGoodReadStatus(dnsResult.reason, {
              indexedAt: lastGoodDnsRegistryRef.current.indexedAt,
              label: "ProofOfWork DNS registry",
            }),
          );
        } else {
          setDnsRegistryError(
            dnsResult.reason instanceof Error
              ? dnsResult.reason.message
              : "ProofOfWork DNS registry summary is unavailable.",
          );
        }
      }

      return fullyLoaded;
    } finally {
      if (generation === requestGenerationRef.current) {
        setRegistryLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      const loaded = await refreshRegistries(false);
      if (active && loaded) {
        await refreshRegistries(true);
      }
    })();
    return () => {
      active = false;
      requestGenerationRef.current += 1;
      requestControllerRef.current?.abort();
    };
  }, [refreshRegistries]);

  return (
    <LandingApp
      dnsRegistryAddress={dnsRegistryAddressForNetwork("livenet")}
      dnsRegistryCounts={dnsRegistryCounts}
      dnsRegistryError={dnsRegistryError}
      dnsRegistryFresh={dnsRegistryFresh}
      dnsRegistryLoaded={dnsRegistryLoaded}
      dnsRegistryLoading={registryLoading}
      dnsRegistryWarning={dnsRegistryWarning}
      registryAddress={registryAddressForNetwork("livenet")}
      registryError={registryError}
      registryFresh={registryFresh}
      registryLoaded={registryLoaded}
      registryLoading={registryLoading}
      registryCounts={registryCounts}
      registryWarning={registryWarning}
      onRefresh={() => void refreshRegistries(true)}
    />
  );
}
