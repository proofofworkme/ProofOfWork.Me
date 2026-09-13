// Historical, frozen source reproductions from the September 8, 2026 ordered audit.
// Run anywhere with Node.js: node ordered-repro.mjs
// Uses only Node built-ins and synthetic/deferred I/O. Reads no files, performs
// no network requests, and never signs, broadcasts, persists or edits anything.
// This preserves audit counterexamples; it does not test future repaired source.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import vm from 'node:vm';
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const frozen = {
  "model": "proofofwork-ordered-audit-historical-fixtures-v1",
  "capturedSource": {
    "path": "src/App.tsx",
    "sha256": "7d69e746fdca1b8895f4f68eef128d1d84089db07e915cd3e7d0b954f7254c1b"
  },
  "typescriptPreparationVersion": "5.9.3",
  "fixtures": {
    "idRegistryContraction": {
      "sourceFile": "src/App.tsx",
      "sourceFileSha256": "7d69e746fdca1b8895f4f68eef128d1d84089db07e915cd3e7d0b954f7254c1b",
      "extractedSource": "function registryStateRegresses(\n  next: PowRegistryState,\n  current: PowRegistryState | undefined,\n) {\n  if (!current || current.records.length === 0) {\n    return false;\n  }\n\n  return next.records.length === 0 || next.records.length < current.records.length;\n}\nfunction applyRegistryState(\n    state: PowRegistryState,\n    activity: PowActivityItem[] = state.activity,\n    allowRegression = false,\n  ) {\n    const current = acceptedRegistryStateRef.current;\n    if (!allowRegression && registryStateRegresses(state, current)) {\n      return current;\n    }\n\n    const accepted = { ...state, activity };\n    acceptedRegistryStateRef.current = accepted;\n    setIdRegistry(accepted.records);\n    setIdListings(accepted.listings);\n    setIdPendingEvents(accepted.pendingEvents);\n    setIdSales(accepted.sales);\n    setIdActivity(accepted.activity);\n    return accepted;\n  }",
      "extractedSourceSha256": "5c7ec80636083298adc0bfff34814be6c7e06bdec68cb2defe468b340adb51eb",
      "executableSource": "function registryStateRegresses(next, current) {\n    if (!current || current.records.length === 0) {\n        return false;\n    }\n    return next.records.length === 0 || next.records.length < current.records.length;\n}\nfunction applyRegistryState(state, activity = state.activity, allowRegression = false) {\n    const current = acceptedRegistryStateRef.current;\n    if (!allowRegression && registryStateRegresses(state, current)) {\n        return current;\n    }\n    const accepted = { ...state, activity };\n    acceptedRegistryStateRef.current = accepted;\n    setIdRegistry(accepted.records);\n    setIdListings(accepted.listings);\n    setIdPendingEvents(accepted.pendingEvents);\n    setIdSales(accepted.sales);\n    setIdActivity(accepted.activity);\n    return accepted;\n}\n",
      "executableSourceSha256": "563d5b038705330465954b8a43f07543e2fa5c4973902546a8da769a090baf70",
      "preparationTransformation": "Installed TypeScript 5.9.3 transpileModule target ES2022; types removed before embedding.",
      "originalScriptName": "id-source-repro.mjs",
      "originalScriptSha256": "9e908f120ba2ffc4f62ae4ebdf76611d2b681aafdbab5ba1d3f7c23b29795364",
      "originalResultName": "id-source-repro.json",
      "originalResultSha256": "62b4e97ff6a138ea2d9e4be63211f4c763ac5b6240a9062ea5cb0a6e299e6225",
      "originalResult": {
        "mode": "Exact local TypeScript source extraction; synthetic current/fresh read states, no API call or production change",
        "source": {
          "path": "src/App.tsx",
          "sha256": "7d69e746fdca1b8895f4f68eef128d1d84089db07e915cd3e7d0b954f7254c1b",
          "extractedSha256": "5c7ec80636083298adc0bfff34814be6c7e06bdec68cb2defe468b340adb51eb"
        },
        "observed": {
          "previousVisibleRecords": 2,
          "freshVisibleRecords": 1,
          "freshPendingCount": 0,
          "acceptedVisibleRecords": 2,
          "acceptedPendingIds": [
            "dropped-pending"
          ],
          "freshOwner": "owner-after",
          "acceptedOwner": "owner-before",
          "stateSetterCalls": 0,
          "returnsOldState": true
        },
        "anchors": [
          "src/App.tsx:17792 registryStateRegresses compares only total records.length",
          "src/App.tsx:21301 applyRegistryState returns old whole state on shrink",
          "src/App.tsx:28009-28017 refreshIds still calls this success and clears fresh last-good warning",
          "src/App.tsx:22227 existingIdRegistration plus canRegisterId blocks known pending",
          "src/App.tsx:44903-44925 pending match presentation"
        ],
        "qualification": "No current live dropped-ID or stale-owner incident observed. Exact ID action preflight remains separate and fail-closed; the finding demonstrates stale long-lived UI projection on legitimate pending contraction, not changed canonical registration/transfer math."
      }
    },
    "desktopResponseRace": {
      "sourceFile": "src/App.tsx",
      "sourceFileSha256": "7d69e746fdca1b8895f4f68eef128d1d84089db07e915cd3e7d0b954f7254c1b",
      "extractedSource": "  async function loadDesktopTarget(target = desktopQuery) {\n    const requestWorkspaceKey = activeWorkspaceStatusKeyRef.current;\n    const requestIsActive = () =>\n      activeWorkspaceStatusKeyRef.current === requestWorkspaceKey;\n    const query = target.trim();\n    if (!query) {\n      setStatusForWorkspace(requestWorkspaceKey, {\n        tone: \"bad\",\n        text: \"Enter a ProofOfWork address or confirmed ProofOfWork ID.\",\n      });\n      return;\n    }\n\n    setDesktopLoading(true);\n    setStatusForWorkspace(requestWorkspaceKey, {\n      tone: \"idle\",\n      text: \"Opening public desktop...\",\n    });\n\n    try {\n      let resolved = resolveRecipientInput(\n        query,\n        network,\n        idRegistry,\n        registryAddress,\n      );\n      if (resolved.isId || resolved.error) {\n        const state = await fetchIdRecordState(network, query);\n        resolved = resolveRecipientInput(\n          query,\n          network,\n          state.records,\n          registryAddress,\n        );\n      }\n\n      if (resolved.error || !resolved.paymentAddress) {\n        setStatusForWorkspace(requestWorkspaceKey, {\n          tone: \"bad\",\n          text:\n            resolved.error ||\n            \"Enter a valid ProofOfWork address or confirmed ProofOfWork ID.\",\n        });\n        return;\n      }\n\n      const mailState = await fetchAddressMail(resolved.paymentAddress, network);\n      const { inboxMessages, sentMessages } = mailState;\n      const publicMail = fileSurfaceMessages(\n        publicDesktopMail(inboxMessages, sentMessages),\n      );\n      const files = publicMail.filter(hasAttachment);\n      const profile: DesktopProfile = {\n        address: resolved.paymentAddress,\n        label: resolved.isId\n          ? resolved.displayRecipient\n          : shortAddress(resolved.paymentAddress),\n        loadedAt: new Date().toISOString(),\n        network,\n        query,\n        resolvedId: resolved.id,\n      };\n\n      if (!requestIsActive()) {\n        return;\n      }\n\n      setDesktopQuery(query);\n      setDesktopProfile(profile);\n      setDesktopMail(publicMail);\n      setDesktopSelectedKey(files[0] ? mailKey(files[0]) : \"\");\n      setActiveFolder(\"desktop\");\n      setComposeOpen(false);\n      setSelectedKey(\"\");\n      setStatusForWorkspace(requestWorkspaceKey, {\n        tone: \"good\",\n        text: `${profile.label} desktop loaded. ${files.length.toLocaleString()} public file${files.length === 1 ? \"\" : \"s\"}.`,\n      });\n    } catch (error) {\n      setStatusForWorkspace(requestWorkspaceKey, {\n        tone: \"bad\",\n        text: errorMessage(error, \"Desktop search failed.\"),\n      });\n    } finally {\n      setDesktopLoading(false);\n    }\n  }\n",
      "extractedSourceSha256": "c2db082111fc9357d90cd8cc16be4310d04a6b4946b163117c373081b8e0c36d",
      "executableSource": "  async function loadDesktopTarget(target = desktopQuery) {\n    const requestWorkspaceKey = activeWorkspaceStatusKeyRef.current;\n    const requestIsActive = () =>\n      activeWorkspaceStatusKeyRef.current === requestWorkspaceKey;\n    const query = target.trim();\n    if (!query) {\n      setStatusForWorkspace(requestWorkspaceKey, {\n        tone: \"bad\",\n        text: \"Enter a ProofOfWork address or confirmed ProofOfWork ID.\",\n      });\n      return;\n    }\n\n    setDesktopLoading(true);\n    setStatusForWorkspace(requestWorkspaceKey, {\n      tone: \"idle\",\n      text: \"Opening public desktop...\",\n    });\n\n    try {\n      let resolved = resolveRecipientInput(\n        query,\n        network,\n        idRegistry,\n        registryAddress,\n      );\n      if (resolved.isId || resolved.error) {\n        const state = await fetchIdRecordState(network, query);\n        resolved = resolveRecipientInput(\n          query,\n          network,\n          state.records,\n          registryAddress,\n        );\n      }\n\n      if (resolved.error || !resolved.paymentAddress) {\n        setStatusForWorkspace(requestWorkspaceKey, {\n          tone: \"bad\",\n          text:\n            resolved.error ||\n            \"Enter a valid ProofOfWork address or confirmed ProofOfWork ID.\",\n        });\n        return;\n      }\n\n      const mailState = await fetchAddressMail(resolved.paymentAddress, network);\n      const { inboxMessages, sentMessages } = mailState;\n      const publicMail = fileSurfaceMessages(\n        publicDesktopMail(inboxMessages, sentMessages),\n      );\n      const files = publicMail.filter(hasAttachment);\n      const profile = {\n        address: resolved.paymentAddress,\n        label: resolved.isId\n          ? resolved.displayRecipient\n          : shortAddress(resolved.paymentAddress),\n        loadedAt: new Date().toISOString(),\n        network,\n        query,\n        resolvedId: resolved.id,\n      };\n\n      if (!requestIsActive()) {\n        return;\n      }\n\n      setDesktopQuery(query);\n      setDesktopProfile(profile);\n      setDesktopMail(publicMail);\n      setDesktopSelectedKey(files[0] ? mailKey(files[0]) : \"\");\n      setActiveFolder(\"desktop\");\n      setComposeOpen(false);\n      setSelectedKey(\"\");\n      setStatusForWorkspace(requestWorkspaceKey, {\n        tone: \"good\",\n        text: `${profile.label} desktop loaded. ${files.length.toLocaleString()} public file${files.length === 1 ? \"\" : \"s\"}.`,\n      });\n    } catch (error) {\n      setStatusForWorkspace(requestWorkspaceKey, {\n        tone: \"bad\",\n        text: errorMessage(error, \"Desktop search failed.\"),\n      });\n    } finally {\n      setDesktopLoading(false);\n    }\n  }\n",
      "executableSourceSha256": "64ac7a9c5ea2a1bb5ac173568d2ea486a8618e838729e7335fd839ea9d2a9c37",
      "preparationTransformation": "Removed only const profile: DesktopProfile annotation.",
      "originalScriptName": "ops/desktop-race-repro.mjs",
      "originalScriptSha256": "493ae37a484e8d77508435a8ec0c3200b9c973bad1b219d280661d4433b47774",
      "originalResultName": "ops/desktop-race-result.json",
      "originalResultSha256": "39e8ab246683a7b4da4aa8bf43782bca02b1b1aa3160e3226a62ffa348aee777",
      "originalResult": {
        "atUtc": "2026-09-08T23:25:49.979Z",
        "coverage": "Exact loadDesktopTarget source executed with mocked address resolution, deferred mail I/O, and React state setters. No production requests, browser automation, or live incident observed.",
        "sourceFile": "src/App.tsx",
        "exactFunctionSha256": "c2db082111fc9357d90cd8cc16be4310d04a6b4946b163117c373081b8e0c36d",
        "transformation": "Removed only const profile: DesktopProfile annotation for Node execution.",
        "headerFacts": {
          "desktopPassesOnRefresh": true,
          "desktopOmitsBusy": true,
          "appHeaderDefaultsBusyFalse": true,
          "appHeaderRefreshUsesBusyForDisabled": true,
          "source": "<AppHeader\n        accountStats={accountStats}\n        network={activeNetwork}\n        onRefresh={onRefresh}\n        subtitle=\"Public file search\"\n        title=\"ProofOfWork Desktop\"\n      />"
        },
        "trace": [
          {
            "label": "A started",
            "query": "",
            "profileAddress": null,
            "loading": true,
            "pending": [
              "A"
            ],
            "status": "Opening public desktop..."
          },
          {
            "label": "B started through still-enabled header refresh",
            "query": "B",
            "profileAddress": null,
            "loading": true,
            "pending": [
              "A",
              "B"
            ],
            "status": "Opening public desktop..."
          },
          {
            "label": "B completed while A still pending",
            "query": "B",
            "profileAddress": "B",
            "loading": false,
            "pending": [
              "A"
            ],
            "status": "B desktop loaded. 0 public files."
          },
          {
            "label": "Older A completed after B",
            "query": "A",
            "profileAddress": "A",
            "loading": false,
            "pending": [],
            "status": "A desktop loaded. 0 public files."
          }
        ],
        "assertions": {
          "bVisibleBeforeA": true,
          "loadingClearedWithRequestOutstanding": true,
          "oldAOverwritesB": true
        }
      },
      "premises": {
        "headerSource": "<AppHeader\n        accountStats={accountStats}\n        network={activeNetwork}\n        onRefresh={onRefresh}\n        subtitle=\"Public file search\"\n        title=\"ProofOfWork Desktop\"\n      />",
        "headerBusyEvidence": "  busy = false,\nclassName=\"topbar-action-button topbar-refresh-button\"\n              disabled={busy}",
        "headerFile": "src/shared/components/AppHeader.tsx",
        "headerFileSha256": "47ab8fd12c9b63469f541bcc3efc7f3e170baf03849c1a68a4b7f3b602f7453d"
      }
    },
    "browserNetworkSelection": {
      "sourceFile": "src/App.tsx",
      "sourceFileSha256": "7d69e746fdca1b8895f4f68eef128d1d84089db07e915cd3e7d0b954f7254c1b",
      "extractedSource": "async (\n      target = query,\n      targetNetwork = network,\n      updateHistory = true,\n    ) => {\n      const generation = ++loadGenerationRef.current;\n      const txid = target.trim().toLowerCase();\n      if (!/^[0-9a-f]{64}$/u.test(txid)) {\n        setLoading(false);\n        setPage(undefined);\n        setStatus({ tone: \"bad\", text: \"Enter a valid ProofOfWork txid.\" });\n        return;\n      }\n\n      setLoading(true);\n      setStatus({\n        tone: \"idle\",\n        text: \"Loading verified page from ProofOfWork...\",\n      });\n      try {\n        const loadedPage = await fetchBrowserPage(txid, targetNetwork);\n        if (generation !== loadGenerationRef.current) {\n          return;\n        }\n        setPage(loadedPage);\n        setQuery(txid);\n        setNetwork(targetNetwork);\n        if (updateHistory) {\n          syncBrowserRoute(txid, targetNetwork);\n        }\n        setStatus({\n          tone: loadedPage.confirmed ? \"good\" : \"idle\",\n          text: loadedPage.confirmed\n            ? \"Verified confirmed HTML page.\"\n            : \"Verified pending HTML page. Confirmation is still final truth.\",\n        });\n      } catch (error) {\n        if (generation !== loadGenerationRef.current) {\n          return;\n        }\n        setPage(undefined);\n        setStatus({\n          tone: \"bad\",\n          text: errorMessage(error, \"Could not load Browser page.\"),\n        });\n      } finally {\n        if (generation === loadGenerationRef.current) {\n          setLoading(false);\n        }\n      }\n    }",
      "extractedSourceSha256": "d7fe22746c3339118dc04df8eb0e419add41f2b20fdab8f84f38f29575c0b21a",
      "executableSource": "async (\n      target = query,\n      targetNetwork = network,\n      updateHistory = true,\n    ) => {\n      const generation = ++loadGenerationRef.current;\n      const txid = target.trim().toLowerCase();\n      if (!/^[0-9a-f]{64}$/u.test(txid)) {\n        setLoading(false);\n        setPage(undefined);\n        setStatus({ tone: \"bad\", text: \"Enter a valid ProofOfWork txid.\" });\n        return;\n      }\n\n      setLoading(true);\n      setStatus({\n        tone: \"idle\",\n        text: \"Loading verified page from ProofOfWork...\",\n      });\n      try {\n        const loadedPage = await fetchBrowserPage(txid, targetNetwork);\n        if (generation !== loadGenerationRef.current) {\n          return;\n        }\n        setPage(loadedPage);\n        setQuery(txid);\n        setNetwork(targetNetwork);\n        if (updateHistory) {\n          syncBrowserRoute(txid, targetNetwork);\n        }\n        setStatus({\n          tone: loadedPage.confirmed ? \"good\" : \"idle\",\n          text: loadedPage.confirmed\n            ? \"Verified confirmed HTML page.\"\n            : \"Verified pending HTML page. Confirmation is still final truth.\",\n        });\n      } catch (error) {\n        if (generation !== loadGenerationRef.current) {\n          return;\n        }\n        setPage(undefined);\n        setStatus({\n          tone: \"bad\",\n          text: errorMessage(error, \"Could not load Browser page.\"),\n        });\n      } finally {\n        if (generation === loadGenerationRef.current) {\n          setLoading(false);\n        }\n      }\n    }",
      "executableSourceSha256": "d7fe22746c3339118dc04df8eb0e419add41f2b20fdab8f84f38f29575c0b21a",
      "preparationTransformation": "None; original callback is already JavaScript.",
      "originalScriptName": "ops/browser-load-repro.mjs",
      "originalScriptSha256": "c12a5be5c35b0904e75aac1ab01bdcd3c33e3aedf334e6eb1939c8bf329a6967",
      "originalResultName": "ops/browser-load-result.json",
      "originalResultSha256": "a31733cf35f5bf17af37279b931316b20db98e5e4b24334782c61466e2c5749d",
      "originalResult": {
        "atUtc": "2026-09-08T23:25:50.309Z",
        "coverage": "Exact standalone BrowserApp loadPage expression with mocked request promises and state setters; no production requests or live incident reproduction. Network selection models actual onChange={setNetwork}.",
        "exactExpressionSha256": "d7fe22746c3339118dc04df8eb0e419add41f2b20fdab8f84f38f29575c0b21a",
        "transformations": [],
        "assertions": {
          "ignoresOlderResultAndKeepsSpinner": true,
          "acceptsNewestResult": true,
          "invalidInputInvalidatesPending": true,
          "selectionOverwritten": true
        },
        "networkSelection": {
          "beforeCompletion": "testnet4",
          "afterCompletion": "livenet",
          "pageNetwork": "livenet",
          "note": "Loaded evidence retains its actual network; issue is lost user selection, not incorrect network label."
        }
      }
    },
    "amoSameCheckpointFreshness": {
      "sourceFile": "src/App.tsx",
      "sourceFileSha256": "7d69e746fdca1b8895f4f68eef128d1d84089db07e915cd3e7d0b954f7254c1b",
      "extractedSource": "function completeTokenListingHistoryMatchesCheckpoint(\n  history: CompleteTokenListingHistory,\n  state: PowTokenState,\n) {\n  return (\n    Number.isSafeInteger(state.indexedThroughBlock) &&\n    state.indexedThroughBlock === history.indexedThroughBlock &&\n    typeof state.indexedThroughBlockHash === \"string\" &&\n    state.indexedThroughBlockHash === history.indexedThroughBlockHash\n  );\n}\n\n  async function currentCompleteGlobalTokenListings(\n    state: PowTokenState,\n    fresh = false,\n  ) {\n    const retained = completeMarketplaceListingHistoryRef.current;\n    if (\n      retained &&\n      completeTokenListingHistoryMatchesCheckpoint(retained, state)\n    ) {\n      return retained;\n    }\n\n    let request = completeMarketplaceListingHistoryInFlightRef.current;\n    if (!request) {\n      request = fetchCompleteTokenListings(\"livenet\", { fresh });\n      completeMarketplaceListingHistoryInFlightRef.current = request;\n    }\n    try {\n      const history = await request;\n      if (!completeTokenListingHistoryMatchesCheckpoint(history, state)) {\n        throw new Error(\n          \"The complete sale-ticket book is awaiting the summary checkpoint.\",\n        );\n      }\n      completeMarketplaceListingHistoryRef.current = history;\n      return history;\n    } finally {\n      if (completeMarketplaceListingHistoryInFlightRef.current === request) {\n        completeMarketplaceListingHistoryInFlightRef.current = null;\n      }\n    }\n  }\n",
      "extractedSourceSha256": "5f7b467a3c6877f16c90272f512ec39da772182eee6a8d60d33d4b89c0bfba71",
      "executableSource": "function completeTokenListingHistoryMatchesCheckpoint(history, state) {\n    return (Number.isSafeInteger(state.indexedThroughBlock) &&\n        state.indexedThroughBlock === history.indexedThroughBlock &&\n        typeof state.indexedThroughBlockHash === \"string\" &&\n        state.indexedThroughBlockHash === history.indexedThroughBlockHash);\n}\nasync function currentCompleteGlobalTokenListings(state, fresh = false) {\n    const retained = completeMarketplaceListingHistoryRef.current;\n    if (retained &&\n        completeTokenListingHistoryMatchesCheckpoint(retained, state)) {\n        return retained;\n    }\n    let request = completeMarketplaceListingHistoryInFlightRef.current;\n    if (!request) {\n        request = fetchCompleteTokenListings(\"livenet\", { fresh });\n        completeMarketplaceListingHistoryInFlightRef.current = request;\n    }\n    try {\n        const history = await request;\n        if (!completeTokenListingHistoryMatchesCheckpoint(history, state)) {\n            throw new Error(\"The complete sale-ticket book is awaiting the summary checkpoint.\");\n        }\n        completeMarketplaceListingHistoryRef.current = history;\n        return history;\n    }\n    finally {\n        if (completeMarketplaceListingHistoryInFlightRef.current === request) {\n            completeMarketplaceListingHistoryInFlightRef.current = null;\n        }\n    }\n}\n",
      "executableSourceSha256": "8c5691768cee08a512514fbf05f4101eefe236472aed08e50176123ba4478be8",
      "preparationTransformation": "Installed TypeScript 5.9.3 transpileModule target ES2022 module None.",
      "originalScriptName": "ops/amo-cache-repro.mjs",
      "originalScriptSha256": "f3aa5ed5346ddf6e7982c40c92d01e698e1ed011813b88245ac6b0c08f53d1cb",
      "originalResultName": "ops/amo-cache-result.json",
      "originalResultSha256": "74b5bac9c6b4eb959829e59d392f892351e618bb48845a4e7bfeb78a63eb7e45",
      "originalResult": {
        "atUtc": "2026-09-08T23:25:54.186Z",
        "coverage": "Exact source functions transpiled using installed TypeScript; mocked retained book and network fetch. No production request or live spent-ticket scenario.",
        "sourceSha256": "5f7b467a3c6877f16c90272f512ec39da772182eee6a8d60d33d4b89c0bfba71",
        "freshRequested": true,
        "retainedIndexedAt": "2026-09-08T22:00:00Z",
        "newSummaryIndexedAt": "2026-09-08T23:00:00Z",
        "fetchCalls": 0,
        "retainedIdentityReturned": true,
        "outputListingCount": 1,
        "assertions": {
          "freshDoesNotInvalidateSameHeightHashCache": true
        },
        "limits": [
          "Demonstrates cache freshness semantics only. Mempool can change without height/hash change, but no real mempool spend or stale production purchase was induced.",
          "Subsequent pending/closed overlay may remove known closed listings; fixture intentionally provides no known closed listing.",
          "Canonical transaction acceptance and write-admission checks remain separate from displayed inventory."
        ]
      }
    },
    "creditHistoryErrorAndRefresh": {
      "sourceFile": "src/App.tsx",
      "sourceFileSha256": "7d69e746fdca1b8895f4f68eef128d1d84089db07e915cd3e7d0b954f7254c1b",
      "extractedSource": "  useEffect(() => {\n    const needsRemotePage =\n      Boolean(holderQuery) ||\n      holderHistoryTotalHint > holderHistoryLocalCount ||\n      holderPageIndex > 0;\n    if (\n      !holderHistoryToken?.tokenId ||\n      network !== \"livenet\" ||\n      !needsRemotePage\n    ) {\n      setRemoteHolderPage(undefined);\n      setRemoteHolderPageLoading(false);\n      return;\n    }\n\n    let cancelled = false;\n    setRemoteHolderPageLoading(true);\n    void fetchTokenHistoryPage<PowTokenHolder>(network, \"holders\", {\n      fresh: true,\n      pageIndex: holderPageIndex,\n      pageSize: TOKEN_LIST_PREVIEW_COUNT,\n      query: holderQuery,\n      tokenScope: holderHistoryToken.tokenId,\n    })\n      .then((page) => {\n        if (!cancelled) {\n          setRemoteHolderPage({ key: holderHistoryKey, page });\n        }\n      })\n      .catch(() => {\n        if (!cancelled) {\n          setRemoteHolderPage(undefined);\n        }\n      })\n      .finally(() => {\n        if (!cancelled) {\n          setRemoteHolderPageLoading(false);\n        }\n      });\n\n    return () => {\n      cancelled = true;\n    };\n  }, [\n    holderHistoryKey,\n    holderHistoryLocalCount,\n    holderHistoryToken?.tokenId,\n    holderHistoryTotalHint,\n    holderPageIndex,\n    holderQuery,\n    network,\n  ]);",
      "extractedSourceSha256": "9a58d6c173b0c3176085ee2a32a79f7f6328fe302377864ff5682ef18863ffc0",
      "executableSource": "useEffect(() => {\n    const needsRemotePage = Boolean(holderQuery) ||\n        holderHistoryTotalHint > holderHistoryLocalCount ||\n        holderPageIndex > 0;\n    if (!holderHistoryToken?.tokenId ||\n        network !== \"livenet\" ||\n        !needsRemotePage) {\n        setRemoteHolderPage(undefined);\n        setRemoteHolderPageLoading(false);\n        return;\n    }\n    let cancelled = false;\n    setRemoteHolderPageLoading(true);\n    void fetchTokenHistoryPage(network, \"holders\", {\n        fresh: true,\n        pageIndex: holderPageIndex,\n        pageSize: TOKEN_LIST_PREVIEW_COUNT,\n        query: holderQuery,\n        tokenScope: holderHistoryToken.tokenId,\n    })\n        .then((page) => {\n        if (!cancelled) {\n            setRemoteHolderPage({ key: holderHistoryKey, page });\n        }\n    })\n        .catch(() => {\n        if (!cancelled) {\n            setRemoteHolderPage(undefined);\n        }\n    })\n        .finally(() => {\n        if (!cancelled) {\n            setRemoteHolderPageLoading(false);\n        }\n    });\n    return () => {\n        cancelled = true;\n    };\n}, [\n    holderHistoryKey,\n    holderHistoryLocalCount,\n    holderHistoryToken?.tokenId,\n    holderHistoryTotalHint,\n    holderPageIndex,\n    holderQuery,\n    network,\n]);\n",
      "executableSourceSha256": "f79fbf96d7cdca5d8705697479b8a1d5ad3fd804653887f372b007251ef9705f",
      "preparationTransformation": "Installed TypeScript 5.9.3 transpileModule target ES2022 module None.",
      "originalScriptName": "ops/credit-history-repro.mjs",
      "originalScriptSha256": "c6c8a4fcb9fcb7f11e3e43b5e2a65c3bc408e341a607aa56032a53dccc2eb2a3",
      "originalResultName": "ops/credit-history-result.json",
      "originalResultSha256": "226667550fa9ae5c271030289726edf54308558332116d830409c75ad42f11d1",
      "originalResult": {
        "atUtc": "2026-09-08T23:25:54.375Z",
        "coverage": "Exact Credit holder-read effect with rejected mock request, and dependency comparison after changed summary data with unchanged holder count. No public request/live error induced.",
        "exactSourceSha256": "9a58d6c173b0c3176085ee2a32a79f7f6328fe302377864ff5682ef18863ffc0",
        "assertions": {
          "failureDropsRemoteAndClearsLoading": true,
          "changedSummaryDoesNotChangeEffectDependencies": true
        },
        "sourceRenderOutcome": "With empty local projected rows, no remote page and loading false, renderHolderList selects No holders yet (or No holder matches with a query); no history-error state exists.",
        "limits": [
          "Fixture proves state/dependency behavior, not a production outage or observed stale balance.",
          "A token/page/query/count change can still trigger a new fetch."
        ]
      }
    },
    "walletUtxoResponseRace": {
      "sourceFile": "src/App.tsx",
      "sourceFileSha256": "7d69e746fdca1b8895f4f68eef128d1d84089db07e915cd3e7d0b954f7254c1b",
      "extractedSource": "  useEffect(() => {\n    if (!address) {\n      setAccountUtxos([]);\n      setAccountUtxosLoaded(false);\n      setAccountUtxosError(\"\");\n      setAccountChainUtxos([]);\n      setAccountChainUtxosLoaded(false);\n      setAccountChainUtxosError(\"\");\n      return;\n    }\n\n    let cancelled = false;\n    const loadAccountUtxos = () => {\n      fetchUtxos(address, network)\n        .then((utxos) => {\n          if (!cancelled) {\n            setAccountUtxos(utxos);\n            setAccountUtxosLoaded(true);\n            setAccountUtxosError(\"\");\n          }\n        })\n        .catch((error) => {\n          if (!cancelled) {\n            setAccountUtxosError(\n              errorMessage(error, \"Wallet UTXOs are unavailable.\"),\n            );\n          }\n        });\n      fetchAddressApiUtxos(address, network)\n        .then((utxos) => {\n          if (!cancelled) {\n            setAccountChainUtxos(utxos);\n            setAccountChainUtxosLoaded(true);\n            setAccountChainUtxosError(\"\");\n          }\n        })\n        .catch((error) => {\n          if (!cancelled) {\n            setAccountChainUtxosError(\n              errorMessage(error, \"Full-node wallet UTXOs are unavailable.\"),\n            );\n          }\n        });\n    };\n\n    setAccountUtxos([]);\n    setAccountUtxosLoaded(false);\n    setAccountUtxosError(\"\");\n    setAccountChainUtxos([]);\n    setAccountChainUtxosLoaded(false);\n    setAccountChainUtxosError(\"\");\n    loadAccountUtxos();\n    const interval = window.setInterval(loadAccountUtxos, 60_000);\n    window.addEventListener(\"focus\", loadAccountUtxos);\n\n    return () => {\n      cancelled = true;\n      window.clearInterval(interval);\n      window.removeEventListener(\"focus\", loadAccountUtxos);\n    };\n  }, [address, network]);\n",
      "extractedSourceSha256": "08e7b63b8b11471400633ad0cbb64657b039b9819236a44c91c9990dc2f84263",
      "executableSource": "useEffect(() => {\n    if (!address) {\n        setAccountUtxos([]);\n        setAccountUtxosLoaded(false);\n        setAccountUtxosError(\"\");\n        setAccountChainUtxos([]);\n        setAccountChainUtxosLoaded(false);\n        setAccountChainUtxosError(\"\");\n        return;\n    }\n    let cancelled = false;\n    const loadAccountUtxos = () => {\n        fetchUtxos(address, network)\n            .then((utxos) => {\n            if (!cancelled) {\n                setAccountUtxos(utxos);\n                setAccountUtxosLoaded(true);\n                setAccountUtxosError(\"\");\n            }\n        })\n            .catch((error) => {\n            if (!cancelled) {\n                setAccountUtxosError(errorMessage(error, \"Wallet UTXOs are unavailable.\"));\n            }\n        });\n        fetchAddressApiUtxos(address, network)\n            .then((utxos) => {\n            if (!cancelled) {\n                setAccountChainUtxos(utxos);\n                setAccountChainUtxosLoaded(true);\n                setAccountChainUtxosError(\"\");\n            }\n        })\n            .catch((error) => {\n            if (!cancelled) {\n                setAccountChainUtxosError(errorMessage(error, \"Full-node wallet UTXOs are unavailable.\"));\n            }\n        });\n    };\n    setAccountUtxos([]);\n    setAccountUtxosLoaded(false);\n    setAccountUtxosError(\"\");\n    setAccountChainUtxos([]);\n    setAccountChainUtxosLoaded(false);\n    setAccountChainUtxosError(\"\");\n    loadAccountUtxos();\n    const interval = window.setInterval(loadAccountUtxos, 60_000);\n    window.addEventListener(\"focus\", loadAccountUtxos);\n    return () => {\n        cancelled = true;\n        window.clearInterval(interval);\n        window.removeEventListener(\"focus\", loadAccountUtxos);\n    };\n}, [address, network]);\n",
      "executableSourceSha256": "03a73d675616a5cc8b0a3c977dbe1021e420e09c190696ec00c09afe5fd766ac",
      "preparationTransformation": "Installed TypeScript 5.9.3 transpileModule target ES2022 module None.",
      "originalScriptName": "ops/wallet-utxo-race-repro.mjs",
      "originalScriptSha256": "9b1c698174e25f1870061544d7091820e8f65c6dc1751af8dd137fb778b1a9cb",
      "originalResultName": "ops/wallet-utxo-race-result.json",
      "originalResultSha256": "58d4e46b4da3c78e166ddbe7d69154119dcc3efd439895b657d5479543ebe0e8",
      "originalResult": {
        "atUtc": "2026-09-08T23:26:24.035Z",
        "coverage": "Exact standalone shared account UTXO effect with deferred mock fetches; initial load plus focus refresh. No provider injection, public request, actual spent output, signing or live incident.",
        "exactSourceSha256": "08e7b63b8b11471400633ad0cbb64657b039b9819236a44c91c9990dc2f84263",
        "newerReplyUtxoCount": 0,
        "afterOlderReplyUtxoCount": 1,
        "assertions": {
          "oldReplyOverwritesNew": true
        },
        "limits": [
          "Proof reservation readiness/action preflight remains separate.",
          "Scope cleanup protects address/network changes, but requests within same scope lack sequence fencing."
        ]
      }
    },
    "infinityCanonicalBranchGuard": {
      "sourceFile": "src/App.tsx",
      "sourceFileSha256": "7d69e746fdca1b8895f4f68eef128d1d84089db07e915cd3e7d0b954f7254c1b",
      "supportSourceFiles": [
        {
          "path": "src/exactAmount.ts",
          "sha256": "099a65054ba40752aa9f75c7048bfa21319aae6ff44ac555898fbe92e5fdae36"
        }
      ],
      "extractedSource": "function infinitySummaryRegresses(\n  next: InfinitySummarySnapshot,\n  current: InfinitySummarySnapshot | undefined,\n) {\n  if (!current) {\n    return false;\n  }\n\n  const currentNetworkValueQ8 = bondDecimalQ8(\n    current.networkValueSats,\n    current.networkValueQ8,\n  );\n  const nextNetworkValueQ8 = bondDecimalQ8(\n    next.networkValueSats,\n    next.networkValueQ8,\n  );\n  return (\n    (currentNetworkValueQ8 !== null &&\n      currentNetworkValueQ8 > 0n &&\n      (nextNetworkValueQ8 === null ||\n        nextNetworkValueQ8 < currentNetworkValueQ8)) ||\n    (compareExactIntegers(current.stats.confirmedSupply, 0) > 0 &&\n      compareExactIntegers(\n        next.stats.confirmedSupply,\n        current.stats.confirmedSupply,\n      ) < 0) ||\n    (current.stats.confirmedBondActions > 0 &&\n      next.stats.confirmedBondActions === 0) ||\n    tokenStateRegresses(next.token, current.token, true)\n  );\n}\nfunction bondDecimalQ8(value: unknown, valueQ8?: unknown) {\n  const exactQ8 = exactIntegerBigInt(valueQ8, { signed: true });\n  if (exactQ8 !== null) {\n    return exactQ8;\n  }\n\n  const decimal = exactDecimalText(value);\n  if (!decimal) {\n    return null;\n  }\n  const [whole, fraction = \"\"] = decimal.split(\".\");\n  if (fraction.length > 8 && /[1-9]/u.test(fraction.slice(8))) {\n    return null;\n  }\n  const fractionQ8 = fraction.slice(0, 8).padEnd(8, \"0\");\n  return BigInt(whole) * 100_000_000n + BigInt(fractionQ8 || \"0\");\n}\n  function applyInfinitySummary(snapshot: InfinitySummarySnapshot) {\n    const current = acceptedBondSummariesRef.current.get(snapshot.tokenId);\n    if (infinitySummaryRegresses(snapshot, current)) {\n      return current;\n    }\n\n    acceptedBondSummariesRef.current.set(snapshot.tokenId, snapshot);\n    setInfinitySummary(snapshot);\n    return snapshot;\n  }\ntype ExactIntegerValue = bigint | number | string;\n\nconst UNSIGNED_INTEGER_PATTERN = /^(?:0|[1-9]\\d*)$/u;\nconst SIGNED_INTEGER_PATTERN = /^-?(?:0|[1-9]\\d*)$/u;\nconst UNSIGNED_DECIMAL_PATTERN = /^(?:0|[1-9]\\d*)(?:\\.\\d+)?$/u;\nconst Q8_SCALE = 100_000_000n;\nconst PLAIN_DECIMAL_FORMAT = new Intl.NumberFormat(\"en-US\", {\n  maximumFractionDigits: 20,\n  useGrouping: false,\n});\n\nfunction exactIntegerBigInt(\n  value: unknown,\n  options: { signed?: boolean } = {},\n): bigint | null {\n  if (typeof value === \"bigint\") {\n    return options.signed || value >= 0n ? value : null;\n  }\n\n  if (typeof value === \"number\") {\n    return Number.isSafeInteger(value) && (options.signed || value >= 0)\n      ? BigInt(value)\n      : null;\n  }\n\n  const text = typeof value === \"string\" ? value.trim() : \"\";\n  const pattern = options.signed ? SIGNED_INTEGER_PATTERN : UNSIGNED_INTEGER_PATTERN;\n  return pattern.test(text) ? BigInt(text) : null;\n}\n\nfunction exactIntegerText(\n  value: unknown,\n  options: { signed?: boolean } = {},\n) {\n  return exactIntegerBigInt(value, options)?.toString() ?? \"\";\n}\n\nfunction exactIntegerNumber(value: unknown) {\n  const exact = exactIntegerBigInt(value);\n  if (exact !== null) {\n    return Number(exact);\n  }\n\n  const numeric = Number(value);\n  return Number.isFinite(numeric) && numeric >= 0 ? Math.floor(numeric) : 0;\n}\n\nfunction exactDecimalText(value: unknown) {\n  if (typeof value === \"number\") {\n    if (!Number.isFinite(value) || value < 0) {\n      return \"\";\n    }\n    const formatted = PLAIN_DECIMAL_FORMAT.format(value);\n    return UNSIGNED_DECIMAL_PATTERN.test(formatted) ? formatted : \"\";\n  }\n  const text = typeof value === \"string\" ? value.trim() : \"\";\n  return UNSIGNED_DECIMAL_PATTERN.test(text) ? text : \"\";\n}\n\nfunction exactDecimalNumber(value: unknown) {\n  const text = exactDecimalText(value);\n  return text ? Number(text) : 0;\n}\n\nfunction compareExactIntegers(left: unknown, right: unknown) {\n  const leftExact = exactIntegerBigInt(left, { signed: true });\n  const rightExact = exactIntegerBigInt(right, { signed: true });\n  if (leftExact !== null && rightExact !== null) {\n    return leftExact < rightExact ? -1 : leftExact > rightExact ? 1 : 0;\n  }\n  return exactIntegerNumber(left) - exactIntegerNumber(right);\n}\n\nfunction formatExactInteger(value: unknown) {\n  const exact = exactIntegerBigInt(value, { signed: true });\n  if (exact !== null) {\n    return exact.toLocaleString(\"en-US\");\n  }\n\n  const numeric = Number(value);\n  return Number.isFinite(numeric)\n    ? Math.floor(numeric).toLocaleString(\"en-US\")\n    : \"0\";\n}\n\nfunction formatExactDecimal(\n  value: unknown,\n  options: { maximumFractionDigits?: number } = {},\n) {\n  const canonical = exactDecimalText(value);\n  if (!canonical) {\n    return \"0\";\n  }\n  const [whole, fraction = \"\"] = canonical.split(\".\");\n  const maximumFractionDigits = Math.max(\n    0,\n    Math.floor(options.maximumFractionDigits ?? fraction.length),\n  );\n  const visibleFraction = fraction\n    .slice(0, maximumFractionDigits)\n    .replace(/0+$/u, \"\");\n  const grouped = BigInt(whole).toLocaleString(\"en-US\");\n  return visibleFraction ? `${grouped}.${visibleFraction}` : grouped;\n}\n\nfunction groupedWhole(value: bigint) {\n  return value.toLocaleString(\"en-US\");\n}\n\nfunction formatExactQ8(\n  value: unknown,\n  options: { maximumFractionDigits?: number } = {},\n) {\n  const exact = exactIntegerBigInt(value, { signed: true });\n  if (exact === null) {\n    return \"\";\n  }\n\n  const maximumFractionDigits = Math.max(\n    0,\n    Math.min(8, Math.floor(options.maximumFractionDigits ?? 8)),\n  );\n  const negative = exact < 0n;\n  const absolute = negative ? -exact : exact;\n  const whole = absolute / Q8_SCALE;\n  const fraction = (absolute % Q8_SCALE).toString().padStart(8, \"0\");\n  const visibleFraction = fraction\n    .slice(0, maximumFractionDigits)\n    .replace(/0+$/u, \"\");\n  const formatted = visibleFraction\n    ? `${groupedWhole(whole)}.${visibleFraction}`\n    : groupedWhole(whole);\n  return negative ? `-${formatted}` : formatted;\n}\n\nfunction exactQ8Number(value: unknown) {\n  const exact = exactIntegerBigInt(value, { signed: true });\n  return exact === null ? 0 : Number(exact) / Number(Q8_SCALE);\n}\n",
      "extractedSourceSha256": "f97e4db6f7a9b17d8656b21286fa631cf918a376892ec23b519f616982543b9a",
      "executableSource": "const UNSIGNED_INTEGER_PATTERN = /^(?:0|[1-9]\\d*)$/u;\nconst SIGNED_INTEGER_PATTERN = /^-?(?:0|[1-9]\\d*)$/u;\nconst UNSIGNED_DECIMAL_PATTERN = /^(?:0|[1-9]\\d*)(?:\\.\\d+)?$/u;\nconst Q8_SCALE = 100000000n;\nconst PLAIN_DECIMAL_FORMAT = new Intl.NumberFormat(\"en-US\", {\n    maximumFractionDigits: 20,\n    useGrouping: false,\n});\nfunction exactIntegerBigInt(value, options = {}) {\n    if (typeof value === \"bigint\") {\n        return options.signed || value >= 0n ? value : null;\n    }\n    if (typeof value === \"number\") {\n        return Number.isSafeInteger(value) && (options.signed || value >= 0)\n            ? BigInt(value)\n            : null;\n    }\n    const text = typeof value === \"string\" ? value.trim() : \"\";\n    const pattern = options.signed ? SIGNED_INTEGER_PATTERN : UNSIGNED_INTEGER_PATTERN;\n    return pattern.test(text) ? BigInt(text) : null;\n}\nfunction exactIntegerText(value, options = {}) {\n    return exactIntegerBigInt(value, options)?.toString() ?? \"\";\n}\nfunction exactIntegerNumber(value) {\n    const exact = exactIntegerBigInt(value);\n    if (exact !== null) {\n        return Number(exact);\n    }\n    const numeric = Number(value);\n    return Number.isFinite(numeric) && numeric >= 0 ? Math.floor(numeric) : 0;\n}\nfunction exactDecimalText(value) {\n    if (typeof value === \"number\") {\n        if (!Number.isFinite(value) || value < 0) {\n            return \"\";\n        }\n        const formatted = PLAIN_DECIMAL_FORMAT.format(value);\n        return UNSIGNED_DECIMAL_PATTERN.test(formatted) ? formatted : \"\";\n    }\n    const text = typeof value === \"string\" ? value.trim() : \"\";\n    return UNSIGNED_DECIMAL_PATTERN.test(text) ? text : \"\";\n}\nfunction exactDecimalNumber(value) {\n    const text = exactDecimalText(value);\n    return text ? Number(text) : 0;\n}\nfunction compareExactIntegers(left, right) {\n    const leftExact = exactIntegerBigInt(left, { signed: true });\n    const rightExact = exactIntegerBigInt(right, { signed: true });\n    if (leftExact !== null && rightExact !== null) {\n        return leftExact < rightExact ? -1 : leftExact > rightExact ? 1 : 0;\n    }\n    return exactIntegerNumber(left) - exactIntegerNumber(right);\n}\nfunction formatExactInteger(value) {\n    const exact = exactIntegerBigInt(value, { signed: true });\n    if (exact !== null) {\n        return exact.toLocaleString(\"en-US\");\n    }\n    const numeric = Number(value);\n    return Number.isFinite(numeric)\n        ? Math.floor(numeric).toLocaleString(\"en-US\")\n        : \"0\";\n}\nfunction formatExactDecimal(value, options = {}) {\n    const canonical = exactDecimalText(value);\n    if (!canonical) {\n        return \"0\";\n    }\n    const [whole, fraction = \"\"] = canonical.split(\".\");\n    const maximumFractionDigits = Math.max(0, Math.floor(options.maximumFractionDigits ?? fraction.length));\n    const visibleFraction = fraction\n        .slice(0, maximumFractionDigits)\n        .replace(/0+$/u, \"\");\n    const grouped = BigInt(whole).toLocaleString(\"en-US\");\n    return visibleFraction ? `${grouped}.${visibleFraction}` : grouped;\n}\nfunction groupedWhole(value) {\n    return value.toLocaleString(\"en-US\");\n}\nfunction formatExactQ8(value, options = {}) {\n    const exact = exactIntegerBigInt(value, { signed: true });\n    if (exact === null) {\n        return \"\";\n    }\n    const maximumFractionDigits = Math.max(0, Math.min(8, Math.floor(options.maximumFractionDigits ?? 8)));\n    const negative = exact < 0n;\n    const absolute = negative ? -exact : exact;\n    const whole = absolute / Q8_SCALE;\n    const fraction = (absolute % Q8_SCALE).toString().padStart(8, \"0\");\n    const visibleFraction = fraction\n        .slice(0, maximumFractionDigits)\n        .replace(/0+$/u, \"\");\n    const formatted = visibleFraction\n        ? `${groupedWhole(whole)}.${visibleFraction}`\n        : groupedWhole(whole);\n    return negative ? `-${formatted}` : formatted;\n}\nfunction exactQ8Number(value) {\n    const exact = exactIntegerBigInt(value, { signed: true });\n    return exact === null ? 0 : Number(exact) / Number(Q8_SCALE);\n}\nfunction bondDecimalQ8(value, valueQ8) {\n    const exactQ8 = exactIntegerBigInt(valueQ8, { signed: true });\n    if (exactQ8 !== null) {\n        return exactQ8;\n    }\n    const decimal = exactDecimalText(value);\n    if (!decimal) {\n        return null;\n    }\n    const [whole, fraction = \"\"] = decimal.split(\".\");\n    if (fraction.length > 8 && /[1-9]/u.test(fraction.slice(8))) {\n        return null;\n    }\n    const fractionQ8 = fraction.slice(0, 8).padEnd(8, \"0\");\n    return BigInt(whole) * 100000000n + BigInt(fractionQ8 || \"0\");\n}\nfunction infinitySummaryRegresses(next, current) {\n    if (!current) {\n        return false;\n    }\n    const currentNetworkValueQ8 = bondDecimalQ8(current.networkValueSats, current.networkValueQ8);\n    const nextNetworkValueQ8 = bondDecimalQ8(next.networkValueSats, next.networkValueQ8);\n    return ((currentNetworkValueQ8 !== null &&\n        currentNetworkValueQ8 > 0n &&\n        (nextNetworkValueQ8 === null ||\n            nextNetworkValueQ8 < currentNetworkValueQ8)) ||\n        (compareExactIntegers(current.stats.confirmedSupply, 0) > 0 &&\n            compareExactIntegers(next.stats.confirmedSupply, current.stats.confirmedSupply) < 0) ||\n        (current.stats.confirmedBondActions > 0 &&\n            next.stats.confirmedBondActions === 0) ||\n        tokenStateRegresses(next.token, current.token, true));\n}\nfunction applyInfinitySummary(snapshot) {\n    const current = acceptedBondSummariesRef.current.get(snapshot.tokenId);\n    if (infinitySummaryRegresses(snapshot, current)) {\n        return current;\n    }\n    acceptedBondSummariesRef.current.set(snapshot.tokenId, snapshot);\n    setInfinitySummary(snapshot);\n    return snapshot;\n}\n",
      "executableSourceSha256": "d3b1df1add0c23170ec5df906c319f876599142161b313cbe5882f5b4a493359",
      "preparationTransformation": "Matches original fixture: remove export tokens from exactAmount.ts; recorded concatenation digest uses guard + Q8 helper + apply + exactAmount. Transpile executable order exactAmount + Q8 helper + guard + apply using TypeScript 5.9.3 target ES2022 module None.",
      "originalScriptName": "ops/infinity-regression-repro.mjs",
      "originalScriptSha256": "d0bdfaf93c2c892093ff88af61b5d6020e82df242e4e5062ba742d3fd76c22e9",
      "originalResultName": "ops/infinity-regression-result.json",
      "originalResultSha256": "f9e3a91980a70bea154ff16a3127d90887e2545236aede76990e41a04baaf112",
      "originalResult": {
        "createdAt": "2026-09-08T23:32:42.041Z",
        "kind": "exact-source function fixture, not a live reorg",
        "sourceSha256": "f97e4db6f7a9b17d8656b21286fa631cf918a376892ec23b519f616982543b9a",
        "mocks": [
          "tokenStateRegresses returns false to isolate top-level exact-value/supply guard",
          "React ref and setter"
        ],
        "checks": {
          "newerDifferentBlockLowerCanonicalValuesRejected": true,
          "stateSetterNotCalled": true,
          "retainedOrphanedFixtureIdentity": true
        },
        "coverage": "The fixture supplies an assumed valid canonical reorg result. It demonstrates local acceptance semantics only; it does not prove an actual production reorg or bad API result."
      }
    },
    "workDroppedPendingCount": {
      "sourceFile": "server/proof-api.mjs",
      "sourceFileSha256": "1fe9c3274372eaa1c9a0596b4ead42840861c7b98445eeb6a45e7f1cd6e0c865",
      "extractedSource": "sortedTransfers.filter((transfer) => !transfer.confirmed)\n        .length",
      "extractedSourceSha256": "080ff307a619b02c5aacbb13e092df42ee337690f56a56ca7441b2128e5c7d53",
      "executableSource": "sortedTransfers.filter((transfer) => !transfer.confirmed)\n        .length",
      "executableSourceSha256": "080ff307a619b02c5aacbb13e092df42ee337690f56a56ca7441b2128e5c7d53",
      "preparationTransformation": "Exact unmodified source expression. Result sourceFile normalized to repository-relative form for portability; all other captured result fields remain identical. Real dropped payload embedded from recorded SQL receipt, with complete receipt and payload digests retained.",
      "originalScriptName": "chain/work-pending-source-repro.mjs",
      "originalScriptSha256": "7cfb3d641fce917ec2a742a29e4782f623544a2f6693858f4b0acaab325d475f",
      "originalResultName": "chain/work-pending-source-repro.json",
      "originalResultSha256": "20dd1dc8845c863d7ff7e852fd01acc8c0b4aad67ab6f1ae9c205e6f82734428",
      "originalResultNormalization": "Only sourceFile becomes server/proof-api.mjs; original captured byte digest is retained separately from normalized expected-result digest.",
      "portableExpectedResultSha256": "75d76bfc913dd5ed878bf2b81a020b8e2c50baddaaadd6a650e3540e178c6644",
      "originalResult": {
        "sourceFile": "server/proof-api.mjs",
        "sourceSha256": "1fe9c3274372eaa1c9a0596b4ead42840861c7b98445eeb6a45e7f1cd6e0c865",
        "function": "workTokenStateWithDeltaTransactions",
        "propertyLine": 38396,
        "expression": "sortedTransfers.filter((transfer) => !transfer.confirmed)\n        .length",
        "retainedDroppedRows": 1,
        "computedPendingFromCurrentExpression": 1,
        "actualPendingFromStoredStatus": 0,
        "sourcePredicateMismatch": true,
        "limits": [
          "Executes the exact source counter expression on the real retained dropped SQL payload; does not establish every runtime route by dynamic tracing.",
          "Public pending mismatch independently demonstrated in work-checks.json and Core absence in work-pending.json.",
          "No production code or state changed."
        ]
      },
      "inputSourceName": "chain/work-pending.json",
      "inputSourceSha256": "ede8b6498cc8c6d0d0143aaf04b35fe073d2240dcf926df135cc8fb1adcc4332",
      "inputRows": [
        {
          "kind": "token-transfer",
          "txid": "d13f042e40a7d0dadd8be29e1fadcae0d35803344ecd3ebf32a1089ea9b53679",
          "valid": true,
          "amount": "24.999999",
          "status": "dropped",
          "ticker": "WORK",
          "dropped": true,
          "network": "livenet",
          "payload": "pwt1:send3:d4e5ebf11d104d6a63fb74e42094364b25a5f7199a09e5c0e71408972466a8b8:249999990000000000:1DNJkS3mxpiU4Gzj7fsW77KmgNeNW5rFc8",
          "tokenId": "d4e5ebf11d104d6a63fb74e42094364b25a5f7199a09e5c0e71408972466a8b8",
          "decimals": 16,
          "paidSats": 546,
          "protocol": "pwt1",
          "confirmed": false,
          "createdAt": "2026-09-07T21:49:11.000Z",
          "dataBytes": 129,
          "unitScale": "10000000000000000",
          "indexedFrom": "token-transfers",
          "minerFeeSats": 194,
          "participants": [
            "bc1pyecxmu7t49akvkdvhjfj45k4ah0pw4hvtmjgr28fwgrcj3hclj0q438xyp",
            "1DNJkS3mxpiU4Gzj7fsW77KmgNeNW5rFc8"
          ],
          "protocolVout": 1,
          "amountVersion": "send3",
          "recordOrdinal": 0,
          "senderAddress": "bc1pyecxmu7t49akvkdvhjfj45k4ah0pw4hvtmjgr28fwgrcj3hclj0q438xyp",
          "amountSubatoms": "249999990000000000",
          "precisionModel": "canonical-work-subatoms-v2",
          "registryAddress": "1638Vn6KtmK8p5r4oGvAXq9nmZb1emU1DV",
          "recipientAddress": "1DNJkS3mxpiU4Gzj7fsW77KmgNeNW5rFc8",
          "amountStorageModel": "work-subatoms-v2"
        }
      ],
      "inputRowsSha256": "05df7f4f2ae00144ca8741cc5c5219c850a6abac18c548e258b8defe475a2f1c"
    },
    "logLifecycleAndIdentity": {
      "sourceFile": "src/App.tsx",
      "sourceFileSha256": "7d69e746fdca1b8895f4f68eef128d1d84089db07e915cd3e7d0b954f7254c1b",
      "extractedSource": "  async function loadLogHistoryPage(\n    pageIndex = 0,\n    silent = true,\n    query = activityQuery,\n    options: { snapshotId?: string } = {},\n  ) {\n    const requestWorkspaceKey = activeWorkspaceStatusKeyRef.current;\n    const readSource = \"log-history\";\n    const readAttempt = nextProofApiReadAttempt();\n    const cacheKey = activityHistoryCacheKey({\n      kind: \"history\",\n      pageIndex,\n      pageSize: ACTIVITY_FEED_PAGE_SIZE,\n      query,\n      snapshotId: options.snapshotId,\n    });\n    if (network !== \"livenet\") {\n      return undefined;\n    }\n\n    if (!silent) {\n      setActivityLoading(true);\n    }\n\n    try {\n      const page = await fetchGlobalActivityHistoryPage(network, {\n        pageIndex,\n        pageSize: ACTIVITY_FEED_PAGE_SIZE,\n        query,\n        snapshotId: options.snapshotId,\n      });\n      clearLastGoodReadWarning(\n        requestWorkspaceKey,\n        readSource,\n        readAttempt,\n      );\n      return acceptActivityHistoryPage(cacheKey, page);\n    } catch (error) {\n      const cachedPage = activityHistoryPagesRef.current.get(cacheKey);\n      const retainedLastGood =\n        Boolean(cachedPage) &&\n        isTransientProofApiReadError(error) &&\n        showLastGoodReadWarning(requestWorkspaceKey, readSource, readAttempt, error, {\n          indexedAt: cachedPage?.indexedAt,\n          indexedThroughBlock:\n            cachedPage?.indexedThroughBlock,\n          label: \"ProofOfWork log history\",\n          snapshotId: cachedPage?.snapshotId,\n        });\n      if (retainedLastGood && cachedPage) {\n        return acceptActivityHistoryPage(cacheKey, cachedPage);\n      }\n      if (!silent && !retainedLastGood) {\n        setActivityHistoryPage(undefined);\n        setStatusForWorkspace(requestWorkspaceKey, {\n          tone: \"bad\",\n          text: errorMessage(error, \"Computer log history failed.\"),\n        });\n      }\n      return undefined;\n    } finally {\n      if (!silent) {\n        setActivityLoading(false);\n      }\n    }\n  }\nfunction activityKey(item: PowActivityItem) {\n  if (item.kind === \"token-listing-closed\" && item.txid) {\n    return `${item.kind}-${item.network}-${item.txid}`;\n  }\n\n  return `${item.kind}-${item.network}-${item.txid}-${item.listingId ?? \"\"}-${item.id ?? \"\"}`;\n}\nfunction activityItemsForView(\n  idActivity: PowActivityItem[],\n  searchedActivity: PowActivityItem[],\n  query: string,\n  profile?: DesktopProfile,\n) {\n  const registryItems = profile\n    ? idActivity.filter((item) =>\n        [\n          profile.address,\n          profile.resolvedId ? `${profile.resolvedId}@proofofwork.me` : \"\",\n          profile.resolvedId ?? \"\",\n          profile.query,\n        ]\n          .filter(Boolean)\n          .some((needle) => activityMatchesSearch(item, needle)),\n      )\n    : idActivity.filter((item) => activityMatchesSearch(item, query));\n\n  const merged = new Map<string, PowActivityItem>();\n  for (const item of [...registryItems, ...searchedActivity]) {\n    merged.set(activityKey(item), item);\n  }\n\n  return [...merged.values()].sort(compareActivityItems);\n}\n",
      "extractedSourceSha256": "dc620c06dd000c8936215226e2c287e207be3761b897f765a91c514ae01f053e",
      "executableSource": "async function loadLogHistoryPage(pageIndex = 0, silent = true, query = activityQuery, options = {}) {\n    const requestWorkspaceKey = activeWorkspaceStatusKeyRef.current;\n    const readSource = \"log-history\";\n    const readAttempt = nextProofApiReadAttempt();\n    const cacheKey = activityHistoryCacheKey({\n        kind: \"history\",\n        pageIndex,\n        pageSize: ACTIVITY_FEED_PAGE_SIZE,\n        query,\n        snapshotId: options.snapshotId,\n    });\n    if (network !== \"livenet\") {\n        return undefined;\n    }\n    if (!silent) {\n        setActivityLoading(true);\n    }\n    try {\n        const page = await fetchGlobalActivityHistoryPage(network, {\n            pageIndex,\n            pageSize: ACTIVITY_FEED_PAGE_SIZE,\n            query,\n            snapshotId: options.snapshotId,\n        });\n        clearLastGoodReadWarning(requestWorkspaceKey, readSource, readAttempt);\n        return acceptActivityHistoryPage(cacheKey, page);\n    }\n    catch (error) {\n        const cachedPage = activityHistoryPagesRef.current.get(cacheKey);\n        const retainedLastGood = Boolean(cachedPage) &&\n            isTransientProofApiReadError(error) &&\n            showLastGoodReadWarning(requestWorkspaceKey, readSource, readAttempt, error, {\n                indexedAt: cachedPage?.indexedAt,\n                indexedThroughBlock: cachedPage?.indexedThroughBlock,\n                label: \"ProofOfWork log history\",\n                snapshotId: cachedPage?.snapshotId,\n            });\n        if (retainedLastGood && cachedPage) {\n            return acceptActivityHistoryPage(cacheKey, cachedPage);\n        }\n        if (!silent && !retainedLastGood) {\n            setActivityHistoryPage(undefined);\n            setStatusForWorkspace(requestWorkspaceKey, {\n                tone: \"bad\",\n                text: errorMessage(error, \"Computer log history failed.\"),\n            });\n        }\n        return undefined;\n    }\n    finally {\n        if (!silent) {\n            setActivityLoading(false);\n        }\n    }\n}\nfunction activityKey(item) {\n    if (item.kind === \"token-listing-closed\" && item.txid) {\n        return `${item.kind}-${item.network}-${item.txid}`;\n    }\n    return `${item.kind}-${item.network}-${item.txid}-${item.listingId ?? \"\"}-${item.id ?? \"\"}`;\n}\nfunction activityItemsForView(idActivity, searchedActivity, query, profile) {\n    const registryItems = profile\n        ? idActivity.filter((item) => [\n            profile.address,\n            profile.resolvedId ? `${profile.resolvedId}@proofofwork.me` : \"\",\n            profile.resolvedId ?? \"\",\n            profile.query,\n        ]\n            .filter(Boolean)\n            .some((needle) => activityMatchesSearch(item, needle)))\n        : idActivity.filter((item) => activityMatchesSearch(item, query));\n    const merged = new Map();\n    for (const item of [...registryItems, ...searchedActivity]) {\n        merged.set(activityKey(item), item);\n    }\n    return [...merged.values()].sort(compareActivityItems);\n}\n",
      "executableSourceSha256": "2a1e87baa762c7b51846c2e262b79e558dbbbe634e30da7bf64f3ff78fafc898",
      "preparationTransformation": "Matches original fixture: recorded raw digest uses load + activityKey + activityItemsForView without separators. Executable concatenation inserts newlines and uses TypeScript 5.9.3 target ES2022 module None.",
      "originalScriptName": "ops/log-lifecycle-repro.mjs",
      "originalScriptSha256": "7324f960b3f56ed3cbc3ec6dc4c78c2dd5aa32848e4ce8122dc2469e387af465",
      "originalResultName": "ops/log-lifecycle-result.json",
      "originalResultSha256": "1630bc2577db977d25722910ce1620ffe1dfddb3d4a536556e1baa1667765c5a",
      "originalResult": {
        "createdAt": "2026-09-08T23:36:47.258Z",
        "kind": "exact-source local fixture; no production request overlap induced",
        "sourceSha256": "dc620c06dd000c8936215226e2c287e207be3761b897f765a91c514ae01f053e",
        "afterB": {
          "selectedPage": 2,
          "loading": false,
          "olderRequestStillPending": true
        },
        "afterA": {
          "selectedPage": 0,
          "loading": false
        },
        "checks": {
          "olderPageOverwritesNewerSameQuery": true,
          "spinnerClearsWhileOlderRequestPending": true,
          "differentProtocolPositionsShareUIKey": true,
          "localFallbackMergesTwoRecordsToOne": true
        },
        "qualifications": [
          "Function fixture mocks network/state, not full React tree. Pagination has no busy prop and Prev/Next can issue overlapping requests from a middle page.",
          "Server page items are rendered directly, so duplicate key demonstrates reconciliation risk; local fallback merge actually drops one fixture record. Current captured60 summary and50 page rows have no duplicate UI keys."
        ]
      },
      "supplementalFixtures": {
        "mountedQueryRefresh": {
          "sourceFile": "src/App.tsx",
          "sourceFileSha256": "7d69e746fdca1b8895f4f68eef128d1d84089db07e915cd3e7d0b954f7254c1b",
          "extractedSource": "  useEffect(() => {\n    if (!(activityMode || activeFolder === \"log\")) {\n      return;\n    }\n\n    if (network !== \"livenet\") {\n      setNetwork(\"livenet\");\n      return;\n    }\n\n    let cancelled = false;\n    let settleTimer: number | undefined;\n\n    const loadVisibleLog = (fresh = false) => {\n      if (document.visibilityState !== \"visible\") {\n        return;\n      }\n\n      void (async () => {\n        await loadLogHead(true, fresh);\n        if (cancelled) {\n          return;\n        }\n\n        const currentPageIndex = activityHistoryPageRef.current?.page ?? 0;\n        await loadLogHistoryPage(currentPageIndex, true);\n        const currentProfile = activityProfileRef.current;\n        if (!cancelled && currentProfile) {\n          void loadActivityTarget(currentProfile.query);\n        }\n\n        if (fresh) {\n          window.clearTimeout(settleTimer);\n          settleTimer = window.setTimeout(() => {\n            if (!cancelled && document.visibilityState === \"visible\") {\n              void loadLogHead(true, false);\n              void loadLogHistoryPage(currentPageIndex, true);\n            }\n          }, BACKGROUND_FRESH_REFRESH_DELAY_MS);\n        }\n      })();\n    };\n\n    void refreshLogSurface(false, false);\n    settleTimer = window.setTimeout(() => {\n      loadVisibleLog(false);\n    }, BACKGROUND_FRESH_REFRESH_DELAY_MS);\n\n    const interval = window.setInterval(() => {\n      loadVisibleLog(false);\n    }, LOG_LIVE_REFRESH_MS);\n    const focusHandler = () => loadVisibleLog(false);\n    window.addEventListener(\"focus\", focusHandler);\n\n    return () => {\n      cancelled = true;\n      window.clearInterval(interval);\n      window.clearTimeout(settleTimer);\n      window.removeEventListener(\"focus\", focusHandler);\n    };\n  }, [\n    activeFolder,\n    activityMode,\n    network,\n  ]);\n  async function loadLogHistoryPage(\n    pageIndex = 0,\n    silent = true,\n    query = activityQuery,\n    options: { snapshotId?: string } = {},\n  ) {\n    const requestWorkspaceKey = activeWorkspaceStatusKeyRef.current;\n    const readSource = \"log-history\";\n    const readAttempt = nextProofApiReadAttempt();\n    const cacheKey = activityHistoryCacheKey({\n      kind: \"history\",\n      pageIndex,\n      pageSize: ACTIVITY_FEED_PAGE_SIZE,\n      query,\n      snapshotId: options.snapshotId,\n    });\n    if (network !== \"livenet\") {\n      return undefined;\n    }\n\n    if (!silent) {\n      setActivityLoading(true);\n    }\n\n    try {\n      const page = await fetchGlobalActivityHistoryPage(network, {\n        pageIndex,\n        pageSize: ACTIVITY_FEED_PAGE_SIZE,\n        query,\n        snapshotId: options.snapshotId,\n      });\n      clearLastGoodReadWarning(\n        requestWorkspaceKey,\n        readSource,\n        readAttempt,\n      );\n      return acceptActivityHistoryPage(cacheKey, page);\n    } catch (error) {\n      const cachedPage = activityHistoryPagesRef.current.get(cacheKey);\n      const retainedLastGood =\n        Boolean(cachedPage) &&\n        isTransientProofApiReadError(error) &&\n        showLastGoodReadWarning(requestWorkspaceKey, readSource, readAttempt, error, {\n          indexedAt: cachedPage?.indexedAt,\n          indexedThroughBlock:\n            cachedPage?.indexedThroughBlock,\n          label: \"ProofOfWork log history\",\n          snapshotId: cachedPage?.snapshotId,\n        });\n      if (retainedLastGood && cachedPage) {\n        return acceptActivityHistoryPage(cacheKey, cachedPage);\n      }\n      if (!silent && !retainedLastGood) {\n        setActivityHistoryPage(undefined);\n        setStatusForWorkspace(requestWorkspaceKey, {\n          tone: \"bad\",\n          text: errorMessage(error, \"Computer log history failed.\"),\n        });\n      }\n      return undefined;\n    } finally {\n      if (!silent) {\n        setActivityLoading(false);\n      }\n    }\n  }\n",
          "extractedSourceSha256": "b8524edaf145c9db4a7fb8b77cd4b985fd4444b3c87ed07080738bcd3221dc6e",
          "executableSource": "function installMountedRender(activityQuery) {\n    async function loadLogHistoryPage(pageIndex = 0, silent = true, query = activityQuery, options = {}) {\n        const requestWorkspaceKey = activeWorkspaceStatusKeyRef.current;\n        const readSource = \"log-history\";\n        const readAttempt = nextProofApiReadAttempt();\n        const cacheKey = activityHistoryCacheKey({\n            kind: \"history\",\n            pageIndex,\n            pageSize: ACTIVITY_FEED_PAGE_SIZE,\n            query,\n            snapshotId: options.snapshotId,\n        });\n        if (network !== \"livenet\") {\n            return undefined;\n        }\n        if (!silent) {\n            setActivityLoading(true);\n        }\n        try {\n            const page = await fetchGlobalActivityHistoryPage(network, {\n                pageIndex,\n                pageSize: ACTIVITY_FEED_PAGE_SIZE,\n                query,\n                snapshotId: options.snapshotId,\n            });\n            clearLastGoodReadWarning(requestWorkspaceKey, readSource, readAttempt);\n            return acceptActivityHistoryPage(cacheKey, page);\n        }\n        catch (error) {\n            const cachedPage = activityHistoryPagesRef.current.get(cacheKey);\n            const retainedLastGood = Boolean(cachedPage) &&\n                isTransientProofApiReadError(error) &&\n                showLastGoodReadWarning(requestWorkspaceKey, readSource, readAttempt, error, {\n                    indexedAt: cachedPage?.indexedAt,\n                    indexedThroughBlock: cachedPage?.indexedThroughBlock,\n                    label: \"ProofOfWork log history\",\n                    snapshotId: cachedPage?.snapshotId,\n                });\n            if (retainedLastGood && cachedPage) {\n                return acceptActivityHistoryPage(cacheKey, cachedPage);\n            }\n            if (!silent && !retainedLastGood) {\n                setActivityHistoryPage(undefined);\n                setStatusForWorkspace(requestWorkspaceKey, {\n                    tone: \"bad\",\n                    text: errorMessage(error, \"Computer log history failed.\"),\n                });\n            }\n            return undefined;\n        }\n        finally {\n            if (!silent) {\n                setActivityLoading(false);\n            }\n        }\n    }\n    useEffect(() => {\n        if (!(activityMode || activeFolder === \"log\")) {\n            return;\n        }\n        if (network !== \"livenet\") {\n            setNetwork(\"livenet\");\n            return;\n        }\n        let cancelled = false;\n        let settleTimer;\n        const loadVisibleLog = (fresh = false) => {\n            if (document.visibilityState !== \"visible\") {\n                return;\n            }\n            void (async () => {\n                await loadLogHead(true, fresh);\n                if (cancelled) {\n                    return;\n                }\n                const currentPageIndex = activityHistoryPageRef.current?.page ?? 0;\n                await loadLogHistoryPage(currentPageIndex, true);\n                const currentProfile = activityProfileRef.current;\n                if (!cancelled && currentProfile) {\n                    void loadActivityTarget(currentProfile.query);\n                }\n                if (fresh) {\n                    window.clearTimeout(settleTimer);\n                    settleTimer = window.setTimeout(() => {\n                        if (!cancelled && document.visibilityState === \"visible\") {\n                            void loadLogHead(true, false);\n                            void loadLogHistoryPage(currentPageIndex, true);\n                        }\n                    }, BACKGROUND_FRESH_REFRESH_DELAY_MS);\n                }\n            })();\n        };\n        void refreshLogSurface(false, false);\n        settleTimer = window.setTimeout(() => {\n            loadVisibleLog(false);\n        }, BACKGROUND_FRESH_REFRESH_DELAY_MS);\n        const interval = window.setInterval(() => {\n            loadVisibleLog(false);\n        }, LOG_LIVE_REFRESH_MS);\n        const focusHandler = () => loadVisibleLog(false);\n        window.addEventListener(\"focus\", focusHandler);\n        return () => {\n            cancelled = true;\n            window.clearInterval(interval);\n            window.clearTimeout(settleTimer);\n            window.removeEventListener(\"focus\", focusHandler);\n        };\n    }, [\n        activeFolder,\n        activityMode,\n        network,\n    ]);\n}\n",
          "executableSourceSha256": "ded46d5ba38cedceaba0d34be82813add5182afe353a788b25e1d92b0ffba861",
          "preparationTransformation": "Matches original fixture: recorded raw digest uses effect + load without separators; execution wraps load + effect in installMountedRender(activityQuery) to model React mounted closure, TypeScript 5.9.3 target ES2022 module None.",
          "originalScriptName": "ops/log-auto-refresh-repro.mjs",
          "originalScriptSha256": "3df410cba13ab68a4cb45987fdf338bc5d8573f9e735667fc9c06fddc8c61fe5",
          "originalResultName": "ops/log-auto-refresh-result.json",
          "originalResultSha256": "6c000d0e3f552501aceb62664af14ac83dd4f2342187ab3507cf841f8747b568",
          "originalResult": {
            "createdAt": "2026-09-08T23:40:56.364Z",
            "kind": "exact-source mounted effect and history-loader fixture; live transitions independently captured by parent",
            "sourceSha256": "b8524edaf145c9db4a7fb8b77cd4b985fd4444b3c87ed07080738bcd3221dc6e",
            "mountedQuery": "",
            "effectDependencies": [
              "log",
              true,
              "livenet"
            ],
            "intervalMs": 15000,
            "requestQueries": [
              ""
            ],
            "textBoxAfter": "8c2fd17b10a6550896035b9f725054d3c6e10c314911808d8f7aaa2955c3015b",
            "bannerAfter": "Log search found 1 matching action.",
            "pageQueryAfter": "",
            "checks": {
              "backgroundUsesMountedEmptyQuery": true,
              "verifiedTxidPageReplacedByGlobal": true,
              "textboxUnchanged": true,
              "successBannerUnchanged": true,
              "pageNoLongerMatchesDisplayedQuery": true,
              "noProfileRepair": true
            },
            "mocks": [
              "React mount closure represented by function argument activityQuery; later textbox and accepted txid page seeded independently",
              "network resolves immediately; interval manually invoked without waiting15sec",
              "silent head fetch and UI setters mocked; effect/history loader source unmodified except TypeScript transpilation"
            ]
          }
        }
      }
    },
    "computerManualMailScope": {
      "sourceFile": "src/App.tsx",
      "sourceFileSha256": "7d69e746fdca1b8895f4f68eef128d1d84089db07e915cd3e7d0b954f7254c1b",
      "extractedSource": "  async function refreshMail(nextFolder: Folder = activeFolder) {\n    if (!address) {\n      setStatus({ tone: \"bad\", text: \"Connect UniSat first.\" });\n      return;\n    }\n\n    setBusy(true);\n    setRefreshing(true);\n    setCheckingBroadcasts(true);\n    setStatus({\n      tone: \"idle\",\n      text: \"Refreshing mail and transaction statuses...\",\n    });\n\n    try {\n      const mailState = await fetchAddressMail(address, network, true);\n      const { inboxMessages, sentMessages } = mailState;\n      const targets = broadcastTargetsFor(\n        address,\n        network,\n        allSentRef.current,\n        sentMessages,\n      );\n      const summary = targets.length\n        ? await checkBroadcastTargets(targets)\n        : undefined;\n      const checkedSentMessages = summary\n        ? applyBroadcastCheckResults(sentMessages, summary)\n        : sentMessages;\n\n      setInbox(inboxMessages);\n      setChainSent(checkedSentMessages);\n      if (summary) {\n        setAllSent((current) => applyBroadcastCheckResults(current, summary));\n      }\n\n      setActiveFolder(nextFolder);\n      if (nextFolder !== \"drafts\") {\n        setComposeOpen(false);\n      }\n      setSelectedKey(selectedInboundKey(nextFolder, inboxMessages));\n      setStatus({\n        tone:\n          summary && summary.failed === summary.results.length ? \"bad\" : \"good\",\n        text: `Refreshed. ${mailboxSummary(inboxMessages, checkedSentMessages)}${\n          summary ? `. ${broadcastCheckSummaryText(summary)}` : \"\"\n        }.`,\n      });\n    } catch (error) {\n      setStatus({ tone: \"bad\", text: errorMessage(error, \"Refresh failed.\") });\n    } finally {\n      setCheckingBroadcasts(false);\n      setRefreshing(false);\n      setBusy(false);\n    }\n  }\n",
      "extractedSourceSha256": "9574dd12e87c678aad14e89bada3cc6842d9b94e92423befb919771fbb07eb24",
      "executableSource": "function mountedRefresh(address, network) {\n    async function refreshMail(nextFolder = activeFolder) {\n        if (!address) {\n            setStatus({ tone: \"bad\", text: \"Connect UniSat first.\" });\n            return;\n        }\n        setBusy(true);\n        setRefreshing(true);\n        setCheckingBroadcasts(true);\n        setStatus({\n            tone: \"idle\",\n            text: \"Refreshing mail and transaction statuses...\",\n        });\n        try {\n            const mailState = await fetchAddressMail(address, network, true);\n            const { inboxMessages, sentMessages } = mailState;\n            const targets = broadcastTargetsFor(address, network, allSentRef.current, sentMessages);\n            const summary = targets.length\n                ? await checkBroadcastTargets(targets)\n                : undefined;\n            const checkedSentMessages = summary\n                ? applyBroadcastCheckResults(sentMessages, summary)\n                : sentMessages;\n            setInbox(inboxMessages);\n            setChainSent(checkedSentMessages);\n            if (summary) {\n                setAllSent((current) => applyBroadcastCheckResults(current, summary));\n            }\n            setActiveFolder(nextFolder);\n            if (nextFolder !== \"drafts\") {\n                setComposeOpen(false);\n            }\n            setSelectedKey(selectedInboundKey(nextFolder, inboxMessages));\n            setStatus({\n                tone: summary && summary.failed === summary.results.length ? \"bad\" : \"good\",\n                text: `Refreshed. ${mailboxSummary(inboxMessages, checkedSentMessages)}${summary ? `. ${broadcastCheckSummaryText(summary)}` : \"\"}.`,\n            });\n        }\n        catch (error) {\n            setStatus({ tone: \"bad\", text: errorMessage(error, \"Refresh failed.\") });\n        }\n        finally {\n            setCheckingBroadcasts(false);\n            setRefreshing(false);\n            setBusy(false);\n        }\n    }\n    return refreshMail;\n}\n",
      "executableSourceSha256": "beaa9664682929a54744db0c043f00448657952751734f43899ae0e97cf2224e",
      "preparationTransformation": "Unmodified extracted refreshMail function; original fixture transpiles a mountedRefresh(address,network) wrapper that returns the captured function. Uses already frozen TypeScript ES2022 module None emission from computer-mail-portable package.",
      "originalScriptName": "ops/computer-mail-scope-repro.mjs",
      "originalScriptSha256": "3b4f444550833b1881a69d39868440b18bfeba2809bb531330fd28c2db0d558d",
      "originalResultName": "ops/computer-mail-scope-result.json",
      "originalResultSha256": "274427317590d065b815e316ec24dfd3ab91faa72262c1977fa122765ab686e7",
      "originalResult": {
        "createdAt": "2026-09-08T23:45:17.875Z",
        "kind": "exact-source manual refresh fixture; no wallet provider, account, signing, or public requests",
        "sourceSha256": "9574dd12e87c678aad14e89bada3cc6842d9b94e92423befb919771fbb07eb24",
        "requested": [
          {
            "address": "account-A",
            "network": "livenet",
            "fresh": true
          }
        ],
        "currentAddress": "account-B",
        "currentNetwork": "livenet",
        "folderAfter": "inbox",
        "inboxAfter": [
          {
            "txid": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            "to": "account-A",
            "network": "livenet",
            "confirmed": true
          }
        ],
        "statusAfter": {
          "tone": "good",
          "text": "Refreshed. one confirmed source-account mail."
        },
        "busyAfter": false,
        "checks": {
          "oldAccountRequestCompletesAfterAccountChanged": true,
          "oldInboxAppliedToNewSession": true,
          "newWorkspaceOverridden": true,
          "oldRefreshReportsSuccess": true
        },
        "mocks": [
          "Function parameters represent captured React address/network",
          "Account switch and opening IDs simulated by clearing/changing harness state",
          "Empty broadcast target set isolates mail response acceptance"
        ],
        "limitations": [
          "No live connected account switch observed. Fixture proves lack of request-scope acceptance guard, not a transaction authorization bypass.",
          "Connection/sync loaders have wallet generation guards; manual refreshMail does not."
        ]
      }
    }
  }
};
async function idRegistryContraction() {
const frozenFixture = frozen.fixtures.idRegistryContraction;
const exactSource=frozenFixture.extractedSource;
const exact=exactSource;
const raw=exactSource;
const executableSource=frozenFixture.executableSource;
const executable=executableSource;
const js=executableSource;
const confirmed={id:'confirmed',network:'livenet',confirmed:true,ownerAddress:'owner-before',receiveAddress:'receive-before'};
const pending={id:'dropped-pending',network:'livenet',confirmed:false,ownerAddress:'pending-author',receiveAddress:'pending-receiver'};
const oldState={records:[confirmed,pending],activity:[],listings:[],pendingEvents:[],sales:[]};
const freshState={records:[{...confirmed,ownerAddress:'owner-after',receiveAddress:'receive-after'}],activity:[],listings:[],pendingEvents:[],sales:[]};
const writes=[];const context={acceptedRegistryStateRef:{current:oldState},oldState,freshState};
for(const key of ['setIdRegistry','setIdListings','setIdPendingEvents','setIdSales','setIdActivity'])context[key]=v=>writes.push({key,value:v});
vm.createContext(context);
const extracted = frozenFixture.extractedSource;
vm.runInContext(frozenFixture.executableSource,context);
const result=vm.runInContext('applyRegistryState(freshState)',context);
const out={mode:'Exact local TypeScript source extraction; synthetic current/fresh read states, no API call or production change',source:{path:'src/App.tsx',sha256:frozenFixture.sourceFileSha256,extractedSha256:crypto.createHash('sha256').update(extracted).digest('hex')},observed:{previousVisibleRecords:oldState.records.length,freshVisibleRecords:freshState.records.length,freshPendingCount:0,acceptedVisibleRecords:result.records.length,acceptedPendingIds:result.records.filter(r=>!r.confirmed).map(r=>r.id),freshOwner: freshState.records[0].ownerAddress,acceptedOwner:result.records[0].ownerAddress,stateSetterCalls:writes.length,returnsOldState:result===oldState},anchors:['src/App.tsx:17792 registryStateRegresses compares only total records.length','src/App.tsx:21301 applyRegistryState returns old whole state on shrink','src/App.tsx:28009-28017 refreshIds still calls this success and clears fresh last-good warning','src/App.tsx:22227 existingIdRegistration plus canRegisterId blocks known pending','src/App.tsx:44903-44925 pending match presentation'],qualification:'No current live dropped-ID or stale-owner incident observed. Exact ID action preflight remains separate and fail-closed; the finding demonstrates stale long-lived UI projection on legitimate pending contraction, not changed canonical registration/transfer math.'};
return out;

}

async function desktopResponseRace() {
const frozenFixture = frozen.fixtures.desktopResponseRace;
const exactSource=frozenFixture.extractedSource;
const exact=exactSource;
const raw=exactSource;
const executableSource=frozenFixture.executableSource;
const executable=executableSource;
const js=executableSource;
const headerSource = "<AppHeader\n        accountStats={accountStats}\n        network={activeNetwork}\n        onRefresh={onRefresh}\n        subtitle=\"Public file search\"\n        title=\"ProofOfWork Desktop\"\n      />";
const header = "  busy = false,\nclassName=\"topbar-action-button topbar-refresh-button\"\n              disabled={busy}";
const headerFacts = {
  desktopPassesOnRefresh: /onRefresh=\{onRefresh\}/.test(headerSource),
  desktopOmitsBusy: !/\bbusy\b/.test(headerSource),
  appHeaderDefaultsBusyFalse: /busy = false/.test(header),
  appHeaderRefreshUsesBusyForDisabled: /className="topbar-action-button topbar-refresh-button"\s+disabled=\{busy\}/.test(header),
  source: headerSource,
};
if (!Object.entries(headerFacts).filter(([k]) => k !== 'source').every(([, v]) => v)) throw new Error('Header premise failed');
const state = { query: '', loading: false, profile: null, mail: [], status: null };
const trace = [];
const pending = new Map();
const record = label => trace.push({ label, query: state.query, profileAddress: state.profile?.address ?? null, loading: state.loading, pending: [...pending.keys()], status: state.status?.text ?? null });
const deps = {
  desktopQuery: '',
  activeWorkspaceStatusKeyRef: { current: 'desktop' },
  network: 'livenet', idRegistry: [], registryAddress: 'fixture-registry',
  setStatusForWorkspace: (_key, value) => { state.status = value; },
  setDesktopLoading: value => { state.loading = value; },
  resolveRecipientInput: query => ({ isId: false, paymentAddress: query }),
  fetchIdRecordState: async () => { throw new Error('Unexpected ID path'); },
  fetchAddressMail: address => new Promise(resolve => { pending.set(address, resolve); }),
  fileSurfaceMessages: messages => messages,
  publicDesktopMail: (inbox, sent) => [...inbox, ...sent],
  hasAttachment: message => Boolean(message.attachment),
  shortAddress: address => address,
  setDesktopQuery: value => { state.query = value; },
  setDesktopProfile: value => { state.profile = value; },
  setDesktopMail: value => { state.mail = value; },
  setDesktopSelectedKey: () => {}, mailKey: message => message.txid,
  setActiveFolder: () => {}, setComposeOpen: () => {}, setSelectedKey: () => {},
  errorMessage: error => String(error),
};
const load = new Function(...Object.keys(deps), executableSource + '\nreturn loadDesktopTarget;')(...Object.values(deps));
const a = load('A'); record('A started');
state.query = 'B';
const b = load('B'); record('B started through still-enabled header refresh');
const resolveB = pending.get('B'); pending.delete('B'); resolveB({inboxMessages: [], sentMessages: []}); await b;
record('B completed while A still pending');
const loadingClearedWithRequestOutstanding = !state.loading && pending.has('A');
const bVisibleBeforeA = state.query === 'B' && state.profile?.address === 'B';
const resolveA = pending.get('A'); pending.delete('A'); resolveA({inboxMessages: [], sentMessages: []}); await a;
record('Older A completed after B');
const oldAOverwritesB = state.query === 'A' && state.profile?.address === 'A';
const result = {
  atUtc: frozenFixture.originalResult.atUtc,
  coverage: 'Exact loadDesktopTarget source executed with mocked address resolution, deferred mail I/O, and React state setters. No production requests, browser automation, or live incident observed.',
  sourceFile: 'src/App.tsx',
  exactFunctionSha256: crypto.createHash('sha256').update(exactSource).digest('hex'),
  transformation: 'Removed only const profile: DesktopProfile annotation for Node execution.',
  headerFacts,
  trace,
  assertions: { bVisibleBeforeA, loadingClearedWithRequestOutstanding, oldAOverwritesB },
};




return result;
}

async function browserNetworkSelection() {
const frozenFixture = frozen.fixtures.browserNetworkSelection;
const exactSource=frozenFixture.extractedSource;
const exact=exactSource;
const raw=exactSource;
const executableSource=frozenFixture.executableSource;
const executable=executableSource;
const js=executableSource;
const txA = 'a'.repeat(64), txB = 'b'.repeat(64);
function harness() {
  const state = {network: 'livenet', query: '', loading: false, page: null, status: null, routes: []};
  const ref = {current: 0};
  const pending = new Map();
  const deps = {
    query: '', network: 'livenet', loadGenerationRef: ref,
    setLoading: x => {state.loading = x;}, setPage: x => {state.page = x;},
    setStatus: x => {state.status = x;}, setQuery: x => {state.query = x;},
    setNetwork: x => {state.network = x;},
    fetchBrowserPage: (txid, network) => new Promise(resolve => pending.set(txid, {resolve, network})),
    syncBrowserRoute: (txid, network) => state.routes.push({txid,network}),
    errorMessage: error => String(error),
  };
  const load = new Function(...Object.keys(deps), 'return (' + exactSource + ');')(...Object.values(deps));
  const finish = (txid, confirmed=true) => {const p=pending.get(txid); pending.delete(txid); p.resolve({txid, network:p.network, confirmed});};
  return {state, ref, pending, load, finish};
}
const concurrent = harness();
const a = concurrent.load(txA), b = concurrent.load(txB);
concurrent.finish(txA); await a;
const ignoresOlderResultAndKeepsSpinner = concurrent.state.page === null && concurrent.state.loading === true;
concurrent.finish(txB); await b;
const acceptsNewestResult = concurrent.state.page?.txid === txB && !concurrent.state.loading;
const invalid = harness();
const pendingValid = invalid.load(txA);
await invalid.load('invalid');
invalid.finish(txA); await pendingValid;
const invalidInputInvalidatesPending = invalid.state.page === undefined && !invalid.state.loading && invalid.state.status.text === 'Enter a valid ProofOfWork txid.';
const networkChange = harness();
const pendingNetwork = networkChange.load(txA, 'livenet');
networkChange.state.network = 'testnet4';
const selectedBeforeCompletion = networkChange.state.network;
networkChange.finish(txA); await pendingNetwork;
const selectionOverwritten = networkChange.state.network === 'livenet';
const result = {
  atUtc:frozenFixture.originalResult.atUtc,
  coverage:'Exact standalone BrowserApp loadPage expression with mocked request promises and state setters; no production requests or live incident reproduction. Network selection models actual onChange={setNetwork}.',
  exactExpressionSha256:crypto.createHash('sha256').update(exactSource).digest('hex'),
  transformations:[],
  assertions:{ignoresOlderResultAndKeepsSpinner,acceptsNewestResult,invalidInputInvalidatesPending,selectionOverwritten},
  networkSelection:{beforeCompletion:selectedBeforeCompletion,afterCompletion:networkChange.state.network,pageNetwork:networkChange.state.page.network,note:'Loaded evidence retains its actual network; issue is lost user selection, not incorrect network label.'},
};




return result;
}

async function amoSameCheckpointFreshness() {
const frozenFixture = frozen.fixtures.amoSameCheckpointFreshness;
const exactSource=frozenFixture.extractedSource;
const exact=exactSource;
const raw=exactSource;
const executableSource=frozenFixture.executableSource;
const executable=executableSource;
const js=executableSource;
const oldTicket={listingId:'a'.repeat(64),confirmed:true,sealConfirmed:true};
const retained={indexedThroughBlock:966120,indexedThroughBlockHash:'b'.repeat(64),indexedAt:'2026-09-08T22:00:00Z',snapshotId:'c'.repeat(64),items:[oldTicket],totalCount:1};
const state={indexedThroughBlock:966120,indexedThroughBlockHash:'b'.repeat(64),indexedAt:'2026-09-08T23:00:00Z',snapshotId:'d'.repeat(64),listings:[],closedListings:[]};
let fetchCalls=0;
const deps={completeMarketplaceListingHistoryRef:{current:retained},completeMarketplaceListingHistoryInFlightRef:{current:null},fetchCompleteTokenListings:async()=>{fetchCalls++;return {...retained,items:[],totalCount:0};}};
const fn=new Function(...Object.keys(deps), executable+'\nreturn currentCompleteGlobalTokenListings;')(...Object.values(deps));
const output=await fn(state,true);
const result={atUtc:frozenFixture.originalResult.atUtc,coverage:'Exact source functions transpiled using installed TypeScript; mocked retained book and network fetch. No production request or live spent-ticket scenario.',sourceSha256:crypto.createHash('sha256').update(raw).digest('hex'),freshRequested:true,retainedIndexedAt:retained.indexedAt,newSummaryIndexedAt:state.indexedAt,fetchCalls,retainedIdentityReturned:output===retained,outputListingCount:output.items.length,assertions:{freshDoesNotInvalidateSameHeightHashCache:fetchCalls===0&&output===retained},limits:['Demonstrates cache freshness semantics only. Mempool can change without height/hash change, but no real mempool spend or stale production purchase was induced.','Subsequent pending/closed overlay may remove known closed listings; fixture intentionally provides no known closed listing.','Canonical transaction acceptance and write-admission checks remain separate from displayed inventory.']};




return result;
}

async function creditHistoryErrorAndRefresh() {
const frozenFixture = frozen.fixtures.creditHistoryErrorAndRefresh;
const exactSource=frozenFixture.extractedSource;
const exact=exactSource;
const raw=exactSource;
const executableSource=frozenFixture.executableSource;
const executable=executableSource;
const js=executableSource;
function scenario({updatedAt,confirmedSupply,run}) {
  const state={remote:undefined,loading:false};let dependencies;
  const vars={holderQuery:'',holderHistoryTotalHint:2,holderHistoryLocalCount:0,holderPageIndex:0,
    holderHistoryToken:{tokenId:'a'.repeat(64),indexedAt:updatedAt,confirmedSupply},network:'livenet',holderHistoryKey:'livenet:'+ 'a'.repeat(64)+':0::25',TOKEN_LIST_PREVIEW_COUNT:25,
    setRemoteHolderPage:x=>{state.remote=x;},setRemoteHolderPageLoading:x=>{state.loading=x;},
    fetchTokenHistoryPage:async()=>{throw new Error('simulated503');},
    useEffect:(callback,deps)=>{dependencies=deps;if(run)callback();}};
  new Function(...Object.keys(vars),js)(...Object.values(vars));
  return {state,dependencies};
}
const before=scenario({updatedAt:'2026-09-08T22:00:00Z',confirmedSupply:100,run:true});
await new Promise(resolve=>setImmediate(resolve));
const after=scenario({updatedAt:'2026-09-08T23:00:00Z',confirmedSupply:200,run:false});
const sameDependencies=before.dependencies.length===after.dependencies.length&&before.dependencies.every((x,i)=>Object.is(x,after.dependencies[i]));
const result={atUtc:frozenFixture.originalResult.atUtc,coverage:'Exact Credit holder-read effect with rejected mock request, and dependency comparison after changed summary data with unchanged holder count. No public request/live error induced.',exactSourceSha256:crypto.createHash('sha256').update(exact).digest('hex'),assertions:{failureDropsRemoteAndClearsLoading:before.state.remote===undefined&&!before.state.loading,changedSummaryDoesNotChangeEffectDependencies:sameDependencies},sourceRenderOutcome:'With empty local projected rows, no remote page and loading false, renderHolderList selects No holders yet (or No holder matches with a query); no history-error state exists.',limits:['Fixture proves state/dependency behavior, not a production outage or observed stale balance.','A token/page/query/count change can still trigger a new fetch.']};


return result;
}

async function walletUtxoResponseRace() {
const frozenFixture = frozen.fixtures.walletUtxoResponseRace;
const exactSource=frozenFixture.extractedSource;
const exact=exactSource;
const raw=exactSource;
const executableSource=frozenFixture.executableSource;
const executable=executableSource;
const js=executableSource;
const state={utxos:[],loaded:false,error:''},pending=[];let focus;
const deps={address:'public-fixture',network:'livenet',
 setAccountUtxos:x=>{state.utxos=x;},setAccountUtxosLoaded:x=>{state.loaded=x;},setAccountUtxosError:x=>{state.error=x;},
 setAccountChainUtxos:()=>{},setAccountChainUtxosLoaded:()=>{},setAccountChainUtxosError:()=>{},
 fetchUtxos:()=>new Promise(resolve=>pending.push(resolve)),fetchAddressApiUtxos:async()=>[],
 errorMessage:e=>String(e),useEffect:callback=>callback(),window:{setInterval:()=>1,clearInterval:()=>{},addEventListener:(name,callback)=>{if(name==='focus')focus=callback;},removeEventListener:()=>{}}};
new Function(...Object.keys(deps),js)(...Object.values(deps));
focus();
pending[1]([]);await new Promise(r=>setImmediate(r));
const newReplyCount=state.utxos.length;
pending[0]([{txid:'a'.repeat(64),vout:0,value:546,status:{confirmed:true}}]);await new Promise(r=>setImmediate(r));
const result={atUtc:frozenFixture.originalResult.atUtc,coverage:'Exact standalone shared account UTXO effect with deferred mock fetches; initial load plus focus refresh. No provider injection, public request, actual spent output, signing or live incident.',exactSourceSha256:crypto.createHash('sha256').update(exact).digest('hex'),newerReplyUtxoCount:newReplyCount,afterOlderReplyUtxoCount:state.utxos.length,assertions:{oldReplyOverwritesNew:pending.length===2&&newReplyCount===0&&state.utxos.length===1},limits:['Proof reservation readiness/action preflight remains separate.','Scope cleanup protects address/network changes, but requests within same scope lack sequence fencing.']};


return result;
}

async function infinityCanonicalBranchGuard() {
const frozenFixture = frozen.fixtures.infinityCanonicalBranchGuard;
const current={tokenId:'powb-fixture',indexedAt:'2026-09-08T23:00:00Z',indexedThroughBlock:100,indexedThroughBlockHash:'a'.repeat(64),networkValueQ8:'100000000000',networkValueSats:'1000',stats:{confirmedSupply:'1000',confirmedBondActions:2},token:{}};
const canonicalAfterReorg={...current,indexedAt:'2026-09-08T23:01:00Z',indexedThroughBlock:101,indexedThroughBlockHash:'b'.repeat(64),networkValueQ8:'99900000000',networkValueSats:'999',stats:{confirmedSupply:'999',confirmedBondActions:1}};
let applied=null;
const ctx={tokenStateRegresses:()=>false,acceptedBondSummariesRef:{current:new Map([[current.tokenId,current]])},setInfinitySummary:value=>{applied=value;}};
vm.createContext(ctx);vm.runInContext(frozenFixture.executableSource,ctx);
const returned=ctx.applyInfinitySummary(canonicalAfterReorg);
const result={createdAt:frozenFixture.originalResult.createdAt,kind:'exact-source function fixture, not a live reorg',sourceSha256:frozenFixture.extractedSourceSha256,mocks:['tokenStateRegresses returns false to isolate top-level exact-value/supply guard','React ref and setter'],checks:{newerDifferentBlockLowerCanonicalValuesRejected:returned===current,stateSetterNotCalled:applied===null,retainedOrphanedFixtureIdentity:ctx.acceptedBondSummariesRef.current.get(current.tokenId)===current},coverage:'The fixture supplies an assumed valid canonical reorg result. It demonstrates local acceptance semantics only; it does not prove an actual production reorg or bad API result.'};
return result;

}

async function workDroppedPendingCount() {
 const record=frozen.fixtures.workDroppedPendingCount;
 assert.equal(sha(JSON.stringify(record.inputRows)),record.inputRowsSha256,'WORK frozen SQL payload digest');
 const observed=vm.runInNewContext(record.executableSource,{sortedTransfers:record.inputRows});
 const pending=record.inputRows.filter(r=>r.status==='pending' && r.dropped!==true).length;
 return {...record.originalResult,retainedDroppedRows:record.inputRows.length,computedPendingFromCurrentExpression:observed,actualPendingFromStoredStatus:pending,sourcePredicateMismatch:observed!==pending};
}

async function logLifecycleAndIdentity() {
const frozenFixture = frozen.fixtures.logLifecycleAndIdentity;
const extra=frozenFixture.supplementalFixtures.mountedQueryRefresh;
assert.equal(sha(extra.extractedSource),extra.extractedSourceSha256,'Log mounted refresh source digest');
assert.equal(sha(extra.executableSource),extra.executableSourceSha256,'Log mounted refresh executable digest');
assert.equal(sha(JSON.stringify(extra.originalResult,null,2)+'\n'),extra.originalResultSha256,'Log mounted refresh original receipt digest');
const extraResult=JSON.parse(JSON.stringify(await logMountedQueryRefresh()));
assert.ok(Object.values(extraResult.checks).every(value=>value===true),'Log mounted refresh all conditions reproduce');
assert.deepEqual(extraResult,extra.originalResult,'Log mounted refresh exact original outcome');
supplementalResults.set('logLifecycleAndIdentity',[{name:'mountedQueryRefresh',sourceFile:extra.sourceFile,sourceFileSha256:extra.sourceFileSha256,extractedSourceSha256:extra.extractedSourceSha256,executableSourceSha256:extra.executableSourceSha256,originalScriptName:extra.originalScriptName,originalScriptSha256:extra.originalScriptSha256,originalResultName:extra.originalResultName,originalResultSha256:extra.originalResultSha256,preparationTransformation:extra.preparationTransformation,outcomeMatchesHistoricalReceipt:true,result:extraResult}]);
const requests=[];let selected;let loading=false;const ctx={activeWorkspaceStatusKeyRef:{current:'log'},activityQuery:'',ACTIVITY_FEED_PAGE_SIZE:50,network:'livenet',nextProofApiReadAttempt:()=>1,activityHistoryCacheKey:JSON.stringify,setActivityLoading:v=>loading=v,fetchGlobalActivityHistoryPage:(network,opts)=>new Promise(resolve=>requests.push({opts,resolve})),clearLastGoodReadWarning:()=>{},acceptActivityHistoryPage:(cache,page)=>{selected=page;return page;},activityHistoryPagesRef:{current:new Map()},setActivityHistoryPage:v=>selected=v,isTransientProofApiReadError:()=>false,showLastGoodReadWarning:()=>false,setStatusForWorkspace:()=>{},errorMessage:e=>e.message,activityMatchesSearch:()=>true,compareActivityItems:()=>0};vm.createContext(ctx);vm.runInContext(frozenFixture.executableSource,ctx);
const A=ctx.loadLogHistoryPage(0,false,'',{snapshotId:'same-snapshot'});const B=ctx.loadLogHistoryPage(2,false,'',{snapshotId:'same-snapshot'});requests[1].resolve({page:2,query:'',snapshotId:'same-snapshot',items:[{eventId:2}]});await B;const afterB={selectedPage:selected.page,loading,olderRequestStillPending:true};requests[0].resolve({page:0,query:'',snapshotId:'same-snapshot',items:[{eventId:1}]});await A;
const first={eventId:1,kind:'token-send',network:'livenet',txid:'a'.repeat(64),protocolVout:1,recordOrdinal:0,confirmed:true};const second={...first,eventId:2,protocolVout:2};
const result={createdAt:frozenFixture.originalResult.createdAt,kind:'exact-source local fixture; no production request overlap induced',sourceSha256:frozenFixture.extractedSourceSha256,afterB,afterA:{selectedPage:selected.page,loading},checks:{olderPageOverwritesNewerSameQuery:selected.page===0,spinnerClearsWhileOlderRequestPending:afterB.loading===false,differentProtocolPositionsShareUIKey:ctx.activityKey(first)===ctx.activityKey(second),localFallbackMergesTwoRecordsToOne:ctx.activityItemsForView([first,second],[],'').length===1},qualifications:['Function fixture mocks network/state, not full React tree. Pagination has no busy prop and Prev/Next can issue overlapping requests from a middle page.','Server page items are rendered directly, so duplicate key demonstrates reconciliation risk; local fallback merge actually drops one fixture record. Current captured60 summary and50 page rows have no duplicate UI keys.']};return result;

}

async function logMountedQueryRefresh() {
const frozenFixture = frozen.fixtures.logLifecycleAndIdentity.supplementalFixtures.mountedQueryRefresh;
const target='8c2fd17b10a6550896035b9f725054d3c6e10c314911808d8f7aaa2955c3015b';let currentPage={query:target,page:0,items:[{eventId:1}],totalCount:1,snapshotId:'verified-snapshot'};let currentTextBox=target;let banner='Log search found 1 matching action.';const calls=[];const intervals=[];let deps;
const ctx={activityMode:true,activeFolder:'log',network:'livenet',setNetwork:()=>{},BACKGROUND_FRESH_REFRESH_DELAY_MS:5000,LOG_LIVE_REFRESH_MS:15000,document:{visibilityState:'visible'},window:{setTimeout:()=>1,clearTimeout:()=>{},setInterval:(fn,ms)=>{intervals.push({fn,ms});return 2;},clearInterval:()=>{},addEventListener:()=>{},removeEventListener:()=>{}},useEffect:(fn,d)=>{deps=d;fn();},refreshLogSurface:()=>{},loadLogHead:async()=>({}),activityHistoryPageRef:{current:currentPage},activityProfileRef:{current:undefined},loadActivityTarget:()=>{throw Error('txid has no profile; should not re-search')},activeWorkspaceStatusKeyRef:{current:'log'},nextProofApiReadAttempt:()=>1,ACTIVITY_FEED_PAGE_SIZE:50,activityHistoryCacheKey:JSON.stringify,setActivityLoading:()=>{},fetchGlobalActivityHistoryPage:async(n,options)=>{calls.push(options);return {page:options.pageIndex,query:options.query,items:[{eventId:99}],totalCount:25440,snapshotId:'same-snapshot'};},clearLastGoodReadWarning:()=>{},acceptActivityHistoryPage:(k,page)=>{currentPage=page;ctx.activityHistoryPageRef.current=page;return page;},activityHistoryPagesRef:{current:new Map()},isTransientProofApiReadError:()=>false,showLastGoodReadWarning:()=>false,setActivityHistoryPage:page=>currentPage=page,setStatusForWorkspace:()=>{},errorMessage:e=>e.message};vm.createContext(ctx);
vm.runInContext(frozenFixture.executableSource,ctx);ctx.installMountedRender('');
intervals[0].fn();await new Promise(resolve=>setImmediate(resolve));
const result={createdAt:frozenFixture.originalResult.createdAt,kind:'exact-source mounted effect and history-loader fixture; live transitions independently captured by parent',sourceSha256:frozenFixture.extractedSourceSha256,mountedQuery:'',effectDependencies:deps,intervalMs:intervals[0].ms,requestQueries:calls.map(x=>x.query),textBoxAfter:currentTextBox,bannerAfter:banner,pageQueryAfter:currentPage.query,checks:{backgroundUsesMountedEmptyQuery:calls[0]?.query==='',verifiedTxidPageReplacedByGlobal:currentPage.query===''&&currentPage.totalCount===25440,textboxUnchanged:currentTextBox===target,successBannerUnchanged:banner==='Log search found 1 matching action.',pageNoLongerMatchesDisplayedQuery:currentPage.query.toLowerCase()!==currentTextBox.toLowerCase(),noProfileRepair:ctx.activityProfileRef.current===undefined},mocks:['React mount closure represented by function argument activityQuery; later textbox and accepted txid page seeded independently','network resolves immediately; interval manually invoked without waiting15sec','silent head fetch and UI setters mocked; effect/history loader source unmodified except TypeScript transpilation']};return result;

}

async function computerManualMailScope() {
const frozenFixture=frozen.fixtures.computerManualMailScope;
let resolveMail;let currentAddress='account-A';let currentNetwork='livenet';let folder='inbox';let inbox=[];let chainSent=[];let status;let busy;const requested=[];
const ctx={activeFolder:'inbox',setBusy:v=>busy=v,setRefreshing:()=>{},setCheckingBroadcasts:()=>{},setStatus:v=>status=v,fetchAddressMail:(address,network,fresh)=>{requested.push({address,network,fresh});return new Promise(resolve=>resolveMail=resolve);},allSentRef:{current:[]},broadcastTargetsFor:()=>[],checkBroadcastTargets:()=>{throw Error('no broadcast targets')},applyBroadcastCheckResults:()=>{throw Error('no status results')},setInbox:v=>inbox=v,setChainSent:v=>chainSent=v,setAllSent:()=>{},setActiveFolder:v=>folder=v,setComposeOpen:()=>{},setSelectedKey:()=>{},selectedInboundKey:()=>'',mailboxSummary:()=> 'one confirmed source-account mail',broadcastCheckSummaryText:()=>'',errorMessage:e=>e.message};vm.createContext(ctx);vm.runInContext(frozenFixture.executableSource,ctx);
const refresh=ctx.mountedRefresh(currentAddress,currentNetwork);const pending=refresh('inbox');currentAddress='account-B';currentNetwork='livenet';folder='ids';inbox=[];chainSent=[];
resolveMail({inboxMessages:[{txid:'a'.repeat(64),to:'account-A',network:'livenet',confirmed:true}],sentMessages:[]});await pending;
const result={createdAt:frozenFixture.originalResult.createdAt,kind:'exact-source manual refresh fixture; no wallet provider, account, signing, or public requests',sourceSha256:frozenFixture.extractedSourceSha256,requested,currentAddress,currentNetwork,folderAfter:folder,inboxAfter:inbox,statusAfter:status,busyAfter:busy,checks:{oldAccountRequestCompletesAfterAccountChanged:requested[0].address==='account-A'&&currentAddress==='account-B',oldInboxAppliedToNewSession:inbox[0]?.to==='account-A',newWorkspaceOverridden:folder==='inbox',oldRefreshReportsSuccess:status?.tone==='good'},mocks:['Function parameters represent captured React address/network','Account switch and opening IDs simulated by clearing/changing harness state','Empty broadcast target set isolates mail response acceptance'],limitations:['No live connected account switch observed. Fixture proves lack of request-scope acceptance guard, not a transaction authorization bypass.','Connection/sync loaders have wallet generation guards; manual refreshMail does not.']};return result;

}

const supplementalResults = new Map();
const fixtures = [];
for (const [name, run] of [["idRegistryContraction",idRegistryContraction],["desktopResponseRace",desktopResponseRace],["browserNetworkSelection",browserNetworkSelection],["amoSameCheckpointFreshness",amoSameCheckpointFreshness],["creditHistoryErrorAndRefresh",creditHistoryErrorAndRefresh],["walletUtxoResponseRace",walletUtxoResponseRace],["infinityCanonicalBranchGuard",infinityCanonicalBranchGuard],["workDroppedPendingCount",workDroppedPendingCount],["logLifecycleAndIdentity",logLifecycleAndIdentity],["computerManualMailScope",computerManualMailScope]]) {
 const record = frozen.fixtures[name];
 assert.equal(sha(record.extractedSource), record.extractedSourceSha256, name + ': frozen original source digest');
 assert.equal(sha(record.executableSource), record.executableSourceSha256, name + ': frozen executable digest');
 assert.equal(sha(JSON.stringify(record.originalResult, null, 2) + '\n'), record.portableExpectedResultSha256 ?? record.originalResultSha256, name + ': expected result bytes digest');
 const result = JSON.parse(JSON.stringify(await run()));
 if (result.assertions) assert.ok(Object.values(result.assertions).every(value => value === true), name + ': all historical fixture conditions must reproduce');
 else if (result.checks) assert.ok(Object.values(result.checks).every(value => value === true), name + ': all historical guard checks must reproduce');
 else if ('sourcePredicateMismatch' in result) assert.equal(result.sourcePredicateMismatch,true,name + ': historical pending predicate mismatch must reproduce');
 else assert.equal(result.observed.returnsOldState, true, name + ': historical ID rejection must reproduce');
 assert.deepEqual(result, record.originalResult, name + ': exact original fixture outcome');
 fixtures.push({name, sourceFile:record.sourceFile, sourceFileSha256:record.sourceFileSha256, supportSourceFiles:record.supportSourceFiles, extractedSourceSha256:record.extractedSourceSha256, executableSourceSha256:record.executableSourceSha256, originalScriptName:record.originalScriptName, originalScriptSha256:record.originalScriptSha256, originalResultName:record.originalResultName, originalResultSha256:record.originalResultSha256, portableExpectedResultSha256:record.portableExpectedResultSha256, originalResultNormalization:record.originalResultNormalization, inputSourceName:record.inputSourceName, inputSourceSha256:record.inputSourceSha256, inputRowsSha256:record.inputRowsSha256, preparationTransformation:record.preparationTransformation, outcomeMatchesHistoricalReceipt:true, result, supplementalResults:supplementalResults.get(name)});
}
console.log(JSON.stringify({model:frozen.model, scope:'Portable historical source fixtures. No production requests, mutable checkout dependency, signing, broadcast or persistence. Original result timestamps are historical capture times, not a current production observation.', capturedSource:frozen.capturedSource, fixtureCount:fixtures.length, supplementalCaseCount:1, ok:true, fixtures}, null, 2));
