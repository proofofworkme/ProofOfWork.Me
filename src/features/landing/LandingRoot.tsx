import { useCallback, useEffect, useRef, useState } from "react";
import { fetchProofApiJson } from "../../shared/api/proofApiClient";
import { registryAddressForNetwork } from "../../shared/protocol/idRegistry";
import { LandingApp } from "./LandingApp";

type LandingRegistryRecord = {
  confirmed: boolean;
};

type RegistrySummaryResponse = {
  records?: unknown;
};

function registryRecordsFromSummary(payload: RegistrySummaryResponse) {
  if (!Array.isArray(payload.records)) {
    throw new Error("Registry summary did not include its visible records.");
  }

  return payload.records.map((record, index) => {
    if (
      !record ||
      typeof record !== "object" ||
      typeof (record as { confirmed?: unknown }).confirmed !== "boolean"
    ) {
      throw new Error(
        `Registry summary record ${index + 1} is malformed. Keeping the last verified summary.`,
      );
    }

    return {
      confirmed: (record as { confirmed: boolean }).confirmed,
    };
  });
}

export default function LandingRoot() {
  const [registryRecords, setRegistryRecords] = useState<
    LandingRegistryRecord[]
  >([]);
  const [registryLoaded, setRegistryLoaded] = useState(false);
  const [registryLoading, setRegistryLoading] = useState(false);
  const [registryFresh, setRegistryFresh] = useState(false);
  const [registryError, setRegistryError] = useState("");
  const requestGenerationRef = useRef(0);
  const requestControllerRef = useRef<AbortController>();

  const refreshRegistry = useCallback(async (fresh = false) => {
    const generation = ++requestGenerationRef.current;
    requestControllerRef.current?.abort();
    const controller = new AbortController();
    requestControllerRef.current = controller;
    setRegistryLoading(true);
    setRegistryError("");

    try {
      const payload = await fetchProofApiJson<RegistrySummaryResponse>(
        fresh ? "/api/v1/registry-summary?fresh=1" : "/api/v1/registry-summary",
        "livenet",
        { signal: controller.signal },
      );
      if (generation !== requestGenerationRef.current) {
        return false;
      }
      setRegistryRecords(registryRecordsFromSummary(payload));
      setRegistryLoaded(true);
      setRegistryFresh(fresh);
      return true;
    } catch (error) {
      if (generation !== requestGenerationRef.current || controller.signal.aborted) {
        return false;
      }
      setRegistryError(
        error instanceof Error
          ? error.message
          : "ProofOfWork ID registry summary is unavailable.",
      );
      return false;
    } finally {
      if (generation === requestGenerationRef.current) {
        setRegistryLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      const loaded = await refreshRegistry(false);
      if (active && loaded) {
        await refreshRegistry(true);
      }
    })();
    return () => {
      active = false;
      requestGenerationRef.current += 1;
      requestControllerRef.current?.abort();
    };
  }, [refreshRegistry]);

  return (
    <LandingApp
      registryAddress={registryAddressForNetwork("livenet")}
      registryError={registryError}
      registryFresh={registryFresh}
      registryLoaded={registryLoaded}
      registryLoading={registryLoading}
      registryRecords={registryRecords}
      onRefresh={() => void refreshRegistry(true)}
    />
  );
}
