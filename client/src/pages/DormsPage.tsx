import {
  DragEvent,
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { apiJson, type ApiHttpError } from "../api";
import { useAuth } from "../auth";
import { CampYearReadOnly } from "../components/CampYearReadOnly";
import { resolveCampYearSelection } from "../campYearSelection";

type CampYearOption = {
  id: string;
  name: string;
  yearLabel: string;
};

type AgeBracket = {
  id: string;
  label: string;
  minAge: number;
  maxAge: number;
  sortOrder: number;
};

type DormRow = {
  id: string;
  name: string;
  purpose: "camper" | "worker";
  genderDesignation: "boys" | "girls" | "co_ed";
  bedCapacity: number;
  ageGroupBracketId: string | null;
};

type BoardCamper = {
  id: string;
  firstName: string;
  lastName: string;
  gender: string;
  dateOfBirth: string;
  checkInStatus: string;
  dormId: string | null;
};

type BoardWorker = {
  id: string;
  firstName: string;
  lastName: string;
  gender: string;
  checkInStatus: string;
  dormId: string | null;
};

type BoardDormLeader = {
  id: string;
  firstName: string;
  lastName: string;
  gender: string;
  checkInStatus: string;
  assignedCamperDormId: string | null;
};

type BoardDormCamper = DormRow & {
  ageGroupBracket: AgeBracket | null;
  campers: BoardCamper[];
  dormLeaders: BoardDormLeader[];
  occupantCount: number;
};

type BoardDormWorker = DormRow & {
  ageGroupBracket: AgeBracket | null;
  workers: BoardWorker[];
  occupantCount: number;
};

/** Matches server `ageOnCampStartUtc` (camp start vs date of birth, UTC calendar). */
function ageOnCampStartUtc(dateOfBirth: string, campStartIso: string): number {
  const dob = new Date(dateOfBirth);
  const campStart = new Date(campStartIso);
  let age = campStart.getUTCFullYear() - dob.getUTCFullYear();
  const monthDiff = campStart.getUTCMonth() - dob.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && campStart.getUTCDate() < dob.getUTCDate())) {
    age -= 1;
  }
  return age;
}

function camperBoardDetailLine(camper: BoardCamper, campStartIso: string | null): string {
  if (campStartIso && camper.dateOfBirth) {
    return `${camper.gender}, age ${ageOnCampStartUtc(camper.dateOfBirth, campStartIso)}`;
  }
  return camper.gender;
}

function camperDormGenderMatchesBoard(designation: string, gender: string): boolean {
  if (designation === "boys") {
    return gender === "male";
  }
  if (designation === "girls") {
    return gender === "female";
  }
  return false;
}

/** Aligns with server dorm assignment warnings for camper → camper dorm. */
function camperAssignExceptionMessages(
  camper: BoardCamper,
  targetDorm: BoardDormCamper,
  campStartIso: string | null,
): string[] {
  const messages: string[] = [];
  if (!camperDormGenderMatchesBoard(targetDorm.genderDesignation, camper.gender)) {
    messages.push(
      "Gender does not match this dorm designation. You can still save this assignment as an exception.",
    );
  }
  if (campStartIso && camper.dateOfBirth && targetDorm.ageGroupBracket) {
    const age = ageOnCampStartUtc(camper.dateOfBirth, campStartIso);
    const { minAge, maxAge } = targetDorm.ageGroupBracket;
    if (age < minAge || age > maxAge) {
      messages.push(
        `This camper is age ${age} at camp start, outside this dorm's age group (${minAge}–${maxAge}). You can still save as an exception.`,
      );
    }
  }
  return messages;
}

type RosterResponse = {
  campYear?: {
    id: string;
    name: string;
    yearLabel: string;
    startDate: string;
  };
  dorm: {
    id: string;
    name: string;
    purpose: string;
    genderDesignation: string;
    bedCapacity: number;
    ageGroupBracket: AgeBracket | null;
  };
  occupantCount: number;
  dormLeaders: {
    id: string;
    firstName: string;
    lastName: string;
    phone: string;
    email: string;
    checkInStatus: string;
  }[];
  campers?: {
    id: string;
    firstName: string;
    lastName: string;
    gender?: string;
    age: number;
    checkInStatus: string;
    medicalNotes: string | null;
    dietaryRestrictions: string | null;
    guardianName: string;
    guardianPhone: string;
  }[];
  workers?: {
    id: string;
    firstName: string;
    lastName: string;
    age: number | null;
    checkInStatus: string;
  }[];
  medicalNotesSummaryLines: string[];
};

const dragMime = "application/x-byc-dorm-person";

type AssignPersonKind = "camper" | "worker" | "dorm_leader";

type AssignDropZone =
  | "unassigned_camper"
  | "unassigned_worker"
  | "unassigned_dorm_leader"
  | { dormPurpose: "camper" | "worker"; dormId: string };

function parseDragPayload(event: DragEvent): {
  personKind: AssignPersonKind;
  personId: string;
} | null {
  const raw = event.dataTransfer.getData(dragMime);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as { personKind?: string; personId?: string };
    if (
      (parsed.personKind === "camper" ||
        parsed.personKind === "worker" ||
        parsed.personKind === "dorm_leader") &&
      typeof parsed.personId === "string"
    ) {
      return { personKind: parsed.personKind as AssignPersonKind, personId: parsed.personId };
    }
  } catch {
    return null;
  }
  return null;
}

export function DormsPage(): React.ReactElement {
  const { user } = useAuth();
  const superAdmin = user?.role === "super_admin";

  const [campYears, setCampYears] = useState<CampYearOption[]>([]);
  const [campYearId, setCampYearId] = useState("");
  const [activeTab, setActiveTab] = useState<"inventory" | "assignments" | "roster">("assignments");
  const [dormFilter, setDormFilter] = useState<"all" | "camper" | "worker">("all");
  const [boardSearch, setBoardSearch] = useState("");
  const [createDormOpen, setCreateDormOpen] = useState(false);
  const [openDormMenuId, setOpenDormMenuId] = useState<string | null>(null);
  const [rosterOpen, setRosterOpen] = useState(false);
  const settingsDialogRef = useRef<HTMLDivElement | null>(null);

  const [dorms, setDorms] = useState<DormRow[]>([]);
  const [brackets, setBrackets] = useState<AgeBracket[]>([]);
  const [inventoryError, setInventoryError] = useState<string | null>(null);
  const [inventoryLoading, setInventoryLoading] = useState(false);

  const [newName, setNewName] = useState("");
  const [newPurpose, setNewPurpose] = useState<"camper" | "worker">("camper");
  const [newGender, setNewGender] = useState<"boys" | "girls" | "co_ed">("boys");
  const [newCapacity, setNewCapacity] = useState("8");
  const [newBracketId, setNewBracketId] = useState("");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editPurpose, setEditPurpose] = useState<"camper" | "worker">("camper");
  const [editGender, setEditGender] = useState<"boys" | "girls" | "co_ed">("boys");
  const [editCapacity, setEditCapacity] = useState("");
  const [editBracketId, setEditBracketId] = useState("");
  const [deletingDormId, setDeletingDormId] = useState<string | null>(null);
  const [dormToDelete, setDormToDelete] = useState<DormRow | null>(null);
  const deleteDormConfirmRef = useRef<HTMLButtonElement | null>(null);

  const [camperDorms, setCamperDorms] = useState<BoardDormCamper[]>([]);
  const [workerDorms, setWorkerDorms] = useState<BoardDormWorker[]>([]);
  const [unassignedCampers, setUnassignedCampers] = useState<BoardCamper[]>([]);
  const [unassignedWorkers, setUnassignedWorkers] = useState<BoardWorker[]>([]);
  const [unassignedDormLeaders, setUnassignedDormLeaders] = useState<BoardDormLeader[]>([]);
  const [boardCampStartIso, setBoardCampStartIso] = useState<string | null>(null);
  const [boardLoading, setBoardLoading] = useState(false);
  const [boardError, setBoardError] = useState<string | null>(null);
  const [assignMessage, setAssignMessage] = useState<string | null>(null);
  const [autoAssignBusy, setAutoAssignBusy] = useState(false);
  const [camperAssignModal, setCamperAssignModal] = useState<{
    camperLabel: string;
    dormLabel: string;
    messages: string[];
    onConfirm: () => void;
  } | null>(null);
  const camperAssignConfirmRef = useRef<HTMLButtonElement | null>(null);

  const [rosterDormId, setRosterDormId] = useState("");
  const [roster, setRoster] = useState<RosterResponse | null>(null);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [rosterError, setRosterError] = useState<string | null>(null);

  const loadCampYears = useCallback(async () => {
    try {
      const data = await apiJson<{
        campYears: CampYearOption[];
        activeCampYearId: string | null;
      }>("/api/admin/camp-years");
      setCampYears(data.campYears);
      setCampYearId((previous) =>
        resolveCampYearSelection(data.campYears, data.activeCampYearId, previous),
      );
    } catch {
      setInventoryError("Could not load camp years.");
    }
  }, []);

  useEffect(() => {
    void loadCampYears();
  }, [loadCampYears]);

  const loadInventory = useCallback(async () => {
    if (!campYearId) {
      setDorms([]);
      setBrackets([]);
      return;
    }
    setInventoryLoading(true);
    setInventoryError(null);
    try {
      const dormsRes = await apiJson<{ dorms: DormRow[] }>(`/api/admin/camp-years/${campYearId}/dorms`);
      setDorms(dormsRes.dorms);
      try {
        const bracketRes = await apiJson<{ ageGroupBrackets: AgeBracket[] }>(
          `/api/admin/camp-years/${campYearId}/age-group-brackets`,
        );
        setBrackets(bracketRes.ageGroupBrackets);
      } catch {
        setBrackets([]);
      }
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : "Could not load dorms (super admins configure inventory).";
      setInventoryError(message);
    } finally {
      setInventoryLoading(false);
    }
  }, [campYearId]);

  const loadBoard = useCallback(async () => {
    if (!campYearId) {
      setCamperDorms([]);
      setWorkerDorms([]);
      setUnassignedCampers([]);
      setUnassignedWorkers([]);
      setUnassignedDormLeaders([]);
      setBoardCampStartIso(null);
      return;
    }
    setBoardLoading(true);
    setBoardError(null);
    try {
      const data = await apiJson<{
        campYearStartDate: string;
        camperDorms: BoardDormCamper[];
        workerDorms: BoardDormWorker[];
        unassignedCampers: BoardCamper[];
        unassignedWorkers: BoardWorker[];
        unassignedDormLeaders: BoardDormLeader[];
      }>(`/api/admin/camp-years/${campYearId}/dorm-assignments/board`);
      setBoardCampStartIso(data.campYearStartDate);
      setCamperDorms(data.camperDorms);
      setWorkerDorms(data.workerDorms);
      setUnassignedCampers(data.unassignedCampers);
      setUnassignedWorkers(data.unassignedWorkers);
      setUnassignedDormLeaders(data.unassignedDormLeaders ?? []);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Could not load assignment board.";
      setBoardError(message);
      setBoardCampStartIso(null);
    } finally {
      setBoardLoading(false);
    }
  }, [campYearId]);

  useEffect(() => {
    void loadInventory();
  }, [loadInventory]);

  useEffect(() => {
    if (activeTab === "assignments") {
      void loadBoard();
    }
  }, [activeTab, loadBoard]);

  const genderOptionsForPurpose = (purpose: "camper" | "worker") => {
    if (purpose === "camper") {
      return (
        <>
          <option value="boys">Boys</option>
          <option value="girls">Girls</option>
        </>
      );
    }
    return (
      <>
        <option value="boys">Boys</option>
        <option value="girls">Girls</option>
        <option value="co_ed">Co-ed</option>
      </>
    );
  };

  useEffect(() => {
    if (newPurpose === "camper" && newGender === "co_ed") {
      setNewGender("boys");
    }
  }, [newPurpose, newGender]);

  useEffect(() => {
    if (editPurpose === "camper" && editGender === "co_ed") {
      setEditGender("boys");
    }
  }, [editPurpose, editGender]);

  const handleCreateDorm = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!superAdmin || !campYearId) {
      return;
    }
    setInventoryError(null);
    const capacityParsed = Number.parseInt(newCapacity, 10);
    if (Number.isNaN(capacityParsed) || capacityParsed < 1) {
      setInventoryError("Bed capacity must be a positive integer.");
      return;
    }
    try {
      await apiJson(`/api/admin/camp-years/${campYearId}/dorms`, {
        method: "POST",
        body: JSON.stringify({
          name: newName.trim(),
          purpose: newPurpose,
          genderDesignation: newGender,
          bedCapacity: capacityParsed,
          ageGroupBracketId:
            newPurpose === "camper" && newBracketId ? newBracketId : null,
        }),
      });
      setNewName("");
      setNewCapacity("8");
      setNewBracketId("");
      await loadInventory();
      await loadBoard();
      setCreateDormOpen(false);
      setActiveTab("assignments");
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Could not create dorm.";
      setInventoryError(message);
    }
  };

  const beginEdit = (dorm: DormRow): void => {
    setEditingId(dorm.id);
    setEditName(dorm.name);
    setEditPurpose(dorm.purpose);
    setEditGender(dorm.genderDesignation);
    setEditCapacity(String(dorm.bedCapacity));
    setEditBracketId(dorm.ageGroupBracketId ?? "");
  };

  const handleSaveEdit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!superAdmin || !campYearId || !editingId) {
      return;
    }
    setInventoryError(null);
    const capacityParsed = Number.parseInt(editCapacity, 10);
    if (Number.isNaN(capacityParsed) || capacityParsed < 1) {
      setInventoryError("Bed capacity must be a positive integer.");
      return;
    }
    try {
      await apiJson(`/api/admin/camp-years/${campYearId}/dorms/${editingId}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: editName.trim(),
          purpose: editPurpose,
          genderDesignation: editGender,
          bedCapacity: capacityParsed,
          ageGroupBracketId:
            editPurpose === "camper" && editBracketId ? editBracketId : null,
        }),
      });
      await loadInventory();
      await loadBoard();
      setEditingId(null);
      setActiveTab("assignments");
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Could not update dorm.";
      setInventoryError(message);
    }
  };

  useEffect(() => {
    if (!dormToDelete) {
      return;
    }
    deleteDormConfirmRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape" && deletingDormId === null) {
        setDormToDelete(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [dormToDelete, deletingDormId]);

  const handleDeleteDorm = async (): Promise<void> => {
    const dorm = dormToDelete;
    if (!superAdmin || !campYearId || !dorm) {
      return;
    }
    setInventoryError(null);
    setDeletingDormId(dorm.id);
    try {
      await apiJson(`/api/admin/camp-years/${campYearId}/dorms/${dorm.id}`, {
        method: "DELETE",
      });
      if (editingId === dorm.id) {
        setEditingId(null);
      }
      if (rosterDormId === dorm.id) {
        setRosterDormId("");
        setRoster(null);
      }
      setDormToDelete(null);
      await loadInventory();
      if (activeTab === "assignments") {
        await loadBoard();
      }
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Could not delete dorm.";
      setInventoryError(message);
    } finally {
      setDeletingDormId(null);
    }
  };

  const postAssign = async (
    personKind: AssignPersonKind,
    personId: string,
    dormId: string | null,
  ): Promise<void> => {
    if (!campYearId) {
      return;
    }
    setAssignMessage(null);
    try {
      const result = await apiJson<{ warnings: string[] }>(
        `/api/admin/camp-years/${campYearId}/dorm-assignments/assign`,
        {
          method: "POST",
          body: JSON.stringify({ personKind, personId, dormId }),
        },
      );
      const lines = result.warnings ?? [];
      if (lines.length > 0) {
        setAssignMessage(lines.join(" "));
      }
      await loadBoard();
    } catch (caught) {
      const err = caught as ApiHttpError;
      setAssignMessage(err instanceof Error ? err.message : "Assignment failed.");
    }
  };

  const findCamperOnBoard = (camperId: string): BoardCamper | undefined => {
    const fromUnassigned = unassignedCampers.find((row) => row.id === camperId);
    if (fromUnassigned) {
      return fromUnassigned;
    }
    for (const dorm of camperDorms) {
      const row = dorm.campers.find((camper) => camper.id === camperId);
      if (row) {
        return row;
      }
    }
    return undefined;
  };

  const requestCamperAssign = (personId: string, dormId: string | null): void => {
    if (!campYearId) {
      return;
    }
    if (dormId === null) {
      void postAssign("camper", personId, null);
      return;
    }
    const camper = findCamperOnBoard(personId);
    const targetDorm = camperDorms.find((dorm) => dorm.id === dormId);
    if (!camper || !targetDorm) {
      void postAssign("camper", personId, dormId);
      return;
    }
    if (camper.dormId === dormId) {
      return;
    }
    const messages = camperAssignExceptionMessages(camper, targetDorm, boardCampStartIso);
    if (messages.length === 0) {
      void postAssign("camper", personId, dormId);
      return;
    }
    setCamperAssignModal({
      camperLabel: `${camper.firstName} ${camper.lastName}`,
      dormLabel: targetDorm.name,
      messages,
      onConfirm: () => {
        setCamperAssignModal(null);
        void postAssign("camper", personId, dormId);
      },
    });
  };

  useEffect(() => {
    if (!camperAssignModal) {
      return;
    }
    camperAssignConfirmRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        setCamperAssignModal(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [camperAssignModal]);

  useEffect(() => {
    if (activeTab === "assignments") {
      return;
    }
    const closeDialog = (): void => {
      setCreateDormOpen(false);
      setEditingId(null);
      setRosterOpen(false);
      setActiveTab("assignments");
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") closeDialog();
    };
    window.addEventListener("keydown", onKeyDown);
    window.requestAnimationFrame(() => settingsDialogRef.current?.querySelector<HTMLElement>("input, select, button")?.focus());
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeTab]);

  useEffect(() => {
    if (!openDormMenuId) return;
    const closeMenu = (): void => setOpenDormMenuId(null);
    const onKeyDown = (event: KeyboardEvent): void => { if (event.key === "Escape") closeMenu(); };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("click", closeMenu);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("click", closeMenu);
    };
  }, [openDormMenuId]);
  const handleAutoAssign = async (): Promise<void> => {
    if (!campYearId) {
      return;
    }
    setAutoAssignBusy(true);
    setAssignMessage(null);
    try {
      const result = await apiJson<{ assignedCampers: number; assignedWorkers: number }>(
        `/api/admin/camp-years/${campYearId}/dorm-assignments/auto-assign`,
        { method: "POST", body: JSON.stringify({}) },
      );
      setAssignMessage(
        `Auto-assigned ${result.assignedCampers} campers and ${result.assignedWorkers} workers with open beds.`,
      );
      await loadBoard();
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Auto-assign failed.";
      setAssignMessage(message);
    } finally {
      setAutoAssignBusy(false);
    }
  };

  const loadRoster = useCallback(async (): Promise<void> => {
    if (!campYearId || !rosterDormId) {
      setRoster(null);
      return;
    }
    setRosterLoading(true);
    setRosterError(null);
    try {
      const data = await apiJson<RosterResponse>(
        `/api/admin/camp-years/${campYearId}/dorms/${rosterDormId}/roster`,
      );
      setRoster(data);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Could not load roster.";
      setRosterError(message);
      setRoster(null);
    } finally {
      setRosterLoading(false);
    }
  }, [campYearId, rosterDormId]);

  useEffect(() => {
    if (activeTab === "roster" && rosterDormId) {
      void loadRoster();
    }
  }, [activeTab, rosterDormId, loadRoster]);

  const dropAccepts = (personKind: AssignPersonKind, zone: AssignDropZone): boolean => {
    if (personKind === "dorm_leader") {
      if (zone === "unassigned_dorm_leader") {
        return true;
      }
      if (zone === "unassigned_camper" || zone === "unassigned_worker") {
        return false;
      }
      return zone.dormPurpose === "camper";
    }
    if (personKind === "camper") {
      if (zone === "unassigned_camper") {
        return true;
      }
      if (zone === "unassigned_worker" || zone === "unassigned_dorm_leader") {
        return false;
      }
      return zone.dormPurpose === "camper";
    }
    if (zone === "unassigned_worker") {
      return true;
    }
    if (zone === "unassigned_camper" || zone === "unassigned_dorm_leader") {
      return false;
    }
    return zone.dormPurpose === "worker";
  };

  const handleDragOverBench = (event: DragEvent, zone: AssignDropZone): void => {
    const payload = parseDragPayload(event);
    if (!payload) {
      return;
    }
    if (dropAccepts(payload.personKind, zone)) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
    }
  };

  const handleDropBench = (event: DragEvent, zone: AssignDropZone): void => {
    event.preventDefault();
    const payload = parseDragPayload(event);
    if (!payload || !dropAccepts(payload.personKind, zone)) {
      return;
    }
    const dormId =
      zone === "unassigned_camper" ||
      zone === "unassigned_worker" ||
      zone === "unassigned_dorm_leader"
        ? null
        : zone.dormId;
    if (payload.personKind === "camper") {
      requestCamperAssign(payload.personId, dormId);
    } else {
      void postAssign(payload.personKind, payload.personId, dormId);
    }
  };

  const sortedDormsForRoster = useMemo(
    () => [...dorms].filter((dorm) => dorm.purpose === "camper").sort((left, right) => left.name.localeCompare(right.name)),
    [dorms],
  );

  const normalizedBoardSearch = boardSearch.trim().toLowerCase();
  const personMatchesSearch = (firstName: string, lastName: string): boolean =>
    !normalizedBoardSearch || `${firstName} ${lastName}`.toLowerCase().includes(normalizedBoardSearch);
  const filteredCamperDorms = camperDorms.filter((dorm) =>
    !normalizedBoardSearch || dorm.name.toLowerCase().includes(normalizedBoardSearch) ||
    dorm.campers.some((camper) => personMatchesSearch(camper.firstName, camper.lastName)) ||
    dorm.dormLeaders.some((leader) => personMatchesSearch(leader.firstName, leader.lastName)),
  );
  const filteredWorkerDorms = workerDorms.filter((dorm) =>
    !normalizedBoardSearch || dorm.name.toLowerCase().includes(normalizedBoardSearch) ||
    dorm.workers.some((worker) => personMatchesSearch(worker.firstName, worker.lastName)),
  );
  return (
    <div className="stack">
      <header className="dorm-page-header">
        <div>
          <p className="dorm-eyebrow">Housing operations</p>
          <h1>Camp dorm assignments</h1>
          <p className="muted dorm-page-intro">Drag people into a dorm or use each person&apos;s move menu for keyboard assignment.</p>
        </div>
        {superAdmin ? (
          <button type="button" className="btn primary dorm-add-button" onClick={() => { setCreateDormOpen(true); setActiveTab("inventory"); }}>
            Add new dorm
          </button>
        ) : null}
      </header>

      <div className="dorm-toolbar" aria-label="Dorm board controls">
        <label className="dorm-search">
          <span className="sr-only">Search dorms and people</span>
          <input type="search" placeholder="Search dorms or people..." value={boardSearch} onChange={(event) => setBoardSearch(event.target.value)} />
        </label>
        <label className="dorm-filter-field">
          <span className="sr-only">Filter dorm type</span>
          <select value={dormFilter} onChange={(event) => setDormFilter(event.target.value as "all" | "camper" | "worker")}>
            <option value="all">All dorms</option>
            <option value="camper">Camper dorms</option>
            <option value="worker">Worker dorms</option>
          </select>
        </label>
        <label className="dorm-year-field">
          <span>Camp year</span>
          {superAdmin ? (
            <select value={campYearId} onChange={(event) => { setCampYearId(event.target.value); setRosterDormId(""); setRoster(null); }}>
              {campYears.length === 0 ? <option value="">No camp years</option> : null}
              {campYears.map((year) => <option key={year.id} value={year.id}>{year.name} ({year.yearLabel})</option>)}
            </select>
          ) : <CampYearReadOnly showLabel={false} campYears={campYears} campYearId={campYearId} />}
        </label>
        <button type="button" className="btn secondary" disabled={!campYearId || autoAssignBusy} onClick={() => void handleAutoAssign()}>
          {autoAssignBusy ? "Assigning..." : "Auto-assign"}
        </button>
      </div>
      {activeTab === "inventory" ? (
        <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) { setCreateDormOpen(false); setEditingId(null); setActiveTab("assignments"); } }}>
          <div ref={settingsDialogRef} className="modal-card stack dorm-settings-dialog" role="dialog" aria-modal="true" aria-labelledby={createDormOpen ? "create-dorm-title" : "edit-dorm-title"}>
          <button type="button" className="dorm-dialog-close" aria-label="Close dorm settings" onClick={() => { setCreateDormOpen(false); setEditingId(null); setActiveTab("assignments"); }}>X</button>
          {!superAdmin ? (
            <p className="muted">
              Only super admins can create or edit dorms. You can still view the list below and use
              Assignments / Roster.
            </p>
          ) : null}
          {inventoryError ? <p className="error">{inventoryError}</p> : null}
          {inventoryLoading ? <p className="muted">Loading…</p> : null}

          {superAdmin && createDormOpen ? (
            <form className="stack" onSubmit={handleCreateDorm}>
              <h2 id="create-dorm-title" style={{ margin: 0 }}>Add dorm</h2>
              <label className="stack">
                Name
                <input value={newName} onChange={(event) => setNewName(event.target.value)} required />
              </label>
              <label className="stack">
                Purpose
                <select
                  value={newPurpose}
                  onChange={(event) => setNewPurpose(event.target.value as "camper" | "worker")}
                >
                  <option value="camper">Camper dorm</option>
                  <option value="worker">Worker dorm</option>
                </select>
              </label>
              <label className="stack">
                Gender designation
                <select
                  value={newGender}
                  onChange={(event) =>
                    setNewGender(event.target.value as "boys" | "girls" | "co_ed")
                  }
                >
                  {genderOptionsForPurpose(newPurpose)}
                </select>
              </label>
              <label className="stack">
                Bed capacity
                <input
                  type="number"
                  min={1}
                  value={newCapacity}
                  onChange={(event) => setNewCapacity(event.target.value)}
                  required
                />
              </label>
              {newPurpose === "camper" ? (
                <label className="stack">
                  Age group (for auto-assign; optional)
                  <select
                    value={newBracketId}
                    onChange={(event) => setNewBracketId(event.target.value)}
                  >
                    <option value="">None (manual placement only)</option>
                    {brackets.map((bracket) => (
                      <option key={bracket.id} value={bracket.id}>
                        {bracket.label} ({bracket.minAge}–{bracket.maxAge})
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <button type="submit" className="btn" disabled={!campYearId}>
                Create dorm
              </button>
            </form>
          ) : null}

          {superAdmin && editingId ? (
            <form className="stack" onSubmit={handleSaveEdit}>
              <h2 id="edit-dorm-title" style={{ margin: 0 }}>Edit dorm settings</h2>
              <label className="stack">
                Name
                <input value={editName} onChange={(event) => setEditName(event.target.value)} required />
              </label>
              <label className="stack">
                Purpose
                <select
                  value={editPurpose}
                  onChange={(event) => setEditPurpose(event.target.value as "camper" | "worker")}
                >
                  <option value="camper">Camper dorm</option>
                  <option value="worker">Worker dorm</option>
                </select>
              </label>
              <label className="stack">
                Gender designation
                <select
                  value={editGender}
                  onChange={(event) =>
                    setEditGender(event.target.value as "boys" | "girls" | "co_ed")
                  }
                >
                  {genderOptionsForPurpose(editPurpose)}
                </select>
              </label>
              <label className="stack">
                Bed capacity
                <input
                  type="number"
                  min={1}
                  value={editCapacity}
                  onChange={(event) => setEditCapacity(event.target.value)}
                  required
                />
              </label>
              {editPurpose === "camper" ? (
                <label className="stack">
                  Age group
                  <select
                    value={editBracketId}
                    onChange={(event) => setEditBracketId(event.target.value)}
                  >
                    <option value="">None</option>
                    {brackets.map((bracket) => (
                      <option key={bracket.id} value={bracket.id}>
                        {bracket.label} ({bracket.minAge}–{bracket.maxAge})
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <div className="row">
                <button type="submit" className="btn">
                  Save
                </button>
                <button type="button" className="btn secondary" onClick={() => { setEditingId(null); setActiveTab("assignments"); }}>
                  Cancel
                </button>
              </div>
            </form>
          ) : null}
        </div>
        </div>
      ) : null}

      {activeTab === "assignments" ? (
        <div className="card stack">
          <h2 className="sr-only">Assignment board</h2>
          {boardError ? <p className="error">{boardError}</p> : null}
          {assignMessage ? <p className="muted">{assignMessage}</p> : null}
          {boardLoading ? <p className="muted">Loading board…</p> : null}

          <h3 hidden={dormFilter === "worker"} className="muted" style={{ margin: 0, fontSize: "0.95rem" }}>
            Campers
          </h3>
          <div hidden={dormFilter === "worker"} className="assign-bench">
            <aside className="unassigned-rail" aria-label="Unassigned campers and dorm leaders">
            <div
              className="assign-column"
              onDragOver={(event) => handleDragOverBench(event, "unassigned_camper")}
              onDrop={(event) => handleDropBench(event, "unassigned_camper")}
            >
              <div className="muted" style={{ fontWeight: 600 }}>
                Unassigned campers
              </div>
              {unassignedCampers.filter((camper) => personMatchesSearch(camper.firstName, camper.lastName)).length === 0 ? <p className="dorm-empty">No unassigned campers.</p> : null}
              {unassignedCampers.filter((camper) => personMatchesSearch(camper.firstName, camper.lastName)).map((camper) => (
                <div key={camper.id} className="assign-person-row">
                  <div
                    className="assign-person"
                    draggable
                    onDragStart={(event) => {
                      event.dataTransfer.setData(
                        dragMime,
                        JSON.stringify({ personKind: "camper", personId: camper.id }),
                      );
                      event.dataTransfer.effectAllowed = "move";
                    }}
                  >
                    {camper.firstName} {camper.lastName}{" "}
                    <span className="muted">({camperBoardDetailLine(camper, boardCampStartIso)})</span>
                  </div>
                  <label className="muted" style={{ fontSize: "0.75rem" }}>
                    Move to (keyboard)
                    <select
                      className="assign-move-select"
                      value={
                        camper.dormId && camperDorms.some((dorm) => dorm.id === camper.dormId)
                          ? camper.dormId
                          : ""
                      }
                      aria-label={`Move ${camper.firstName} ${camper.lastName}, ${camperBoardDetailLine(camper, boardCampStartIso)}`}
                      onChange={(event) => {
                        const value = event.target.value;
                        requestCamperAssign(camper.id, value === "" ? null : value);
                      }}
                    >
                      <option value="">Unassigned</option>
                      {camperDorms.map((dorm) => (
                        <option key={dorm.id} value={dorm.id}>
                          {dorm.name} ({dorm.occupantCount}/{dorm.bedCapacity})
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              ))}
            </div>
            <div
              className="assign-column"
              onDragOver={(event) => handleDragOverBench(event, "unassigned_dorm_leader")}
              onDrop={(event) => handleDropBench(event, "unassigned_dorm_leader")}
            >
              <div className="muted" style={{ fontWeight: 600 }}>
                Unassigned dorm leaders
              </div>
              <div className="muted" style={{ fontSize: "0.7rem", marginBottom: "0.25rem" }}>
                Does not use camper beds
              </div>
              {unassignedDormLeaders.filter((leader) => personMatchesSearch(leader.firstName, leader.lastName)).length === 0 ? <p className="dorm-empty">No unassigned dorm leaders.</p> : null}
              {unassignedDormLeaders.filter((leader) => personMatchesSearch(leader.firstName, leader.lastName)).map((leader) => (
                <div key={leader.id} className="assign-person-row">
                  <div
                    className="assign-person"
                    draggable
                    onDragStart={(event) => {
                      event.dataTransfer.setData(
                        dragMime,
                        JSON.stringify({ personKind: "dorm_leader", personId: leader.id }),
                      );
                      event.dataTransfer.effectAllowed = "move";
                    }}
                  >
                    {leader.firstName} {leader.lastName}{" "}
                    <span className="muted">({leader.gender})</span>
                  </div>
                  <label className="muted" style={{ fontSize: "0.75rem" }}>
                    Move to (keyboard)
                    <select
                      className="assign-move-select"
                      value={
                        leader.assignedCamperDormId &&
                        camperDorms.some((dorm) => dorm.id === leader.assignedCamperDormId)
                          ? leader.assignedCamperDormId
                          : ""
                      }
                      aria-label={`Move dorm leader ${leader.firstName} ${leader.lastName}`}
                      onChange={(event) => {
                        const value = event.target.value;
                        void postAssign("dorm_leader", leader.id, value === "" ? null : value);
                      }}
                    >
                      <option value="">Unassigned</option>
                      {camperDorms.map((dormOption) => (
                        <option key={dormOption.id} value={dormOption.id}>
                          {dormOption.name} ({dormOption.occupantCount}/{dormOption.bedCapacity})
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              ))}
            </div>
            </aside>
            <div className="dorm-grid">
            {filteredCamperDorms.length === 0 ? <p className="dorm-empty dorm-grid-empty">No camper dorms match this search.</p> : null}
            {filteredCamperDorms.map((dorm) => (
              <div
                key={dorm.id}
                className="assign-column"
                onDragOver={(event) =>
                  handleDragOverBench(event, { dormPurpose: "camper", dormId: dorm.id })
                }
                onDrop={(event) => handleDropBench(event, { dormPurpose: "camper", dormId: dorm.id })}
              >
                <div className="dorm-card-header">
                  <div><strong>{dorm.name}</strong><div className="dorm-card-meta">{dorm.genderDesignation} · Camper dorm</div></div>
                  <div className="dorm-card-menu-wrap">
                    <button type="button" className="dorm-menu-button" aria-label={`Actions for ${dorm.name}`} aria-expanded={openDormMenuId === dorm.id} aria-haspopup="true" onClick={(event) => { event.stopPropagation(); setOpenDormMenuId(openDormMenuId === dorm.id ? null : dorm.id); }}>...</button>
                    {openDormMenuId === dorm.id ? <div className="dorm-card-menu" onClick={(event) => event.stopPropagation()}>
                      {superAdmin ? <button type="button" onClick={() => { beginEdit(dorm); setCreateDormOpen(false); setOpenDormMenuId(null); setActiveTab("inventory"); }}>Edit dorm</button> : null}
                      <button type="button" onClick={() => { setRosterDormId(dorm.id); setRosterOpen(true); setOpenDormMenuId(null); setActiveTab("roster"); }}>Printable roster</button>
                    </div> : null}
                  </div>
                </div>
                <div className="dorm-capacity"><span>{dorm.occupantCount} assigned</span><strong>{dorm.occupantCount}/{dorm.bedCapacity}</strong></div>
                {dorm.campers.map((camper) => (
                  <div key={camper.id} className="assign-person-row">
                    <div
                      className="assign-person"
                      draggable
                      onDragStart={(event) => {
                        event.dataTransfer.setData(
                          dragMime,
                          JSON.stringify({ personKind: "camper", personId: camper.id }),
                        );
                        event.dataTransfer.effectAllowed = "move";
                      }}
                    >
                      {camper.firstName} {camper.lastName}{" "}
                      <span className="muted">({camperBoardDetailLine(camper, boardCampStartIso)})</span>
                    </div>
                    <label className="muted" style={{ fontSize: "0.75rem" }}>
                      Move to
                      <select
                        className="assign-move-select"
                        value={
                          camper.dormId && camperDorms.some((column) => column.id === camper.dormId)
                            ? camper.dormId
                            : ""
                        }
                        aria-label={`Move ${camper.firstName} ${camper.lastName}, ${camperBoardDetailLine(camper, boardCampStartIso)}`}
                        onChange={(event) => {
                          const value = event.target.value;
                          requestCamperAssign(camper.id, value === "" ? null : value);
                        }}
                      >
                        <option value="">Unassigned</option>
                        {camperDorms.map((column) => (
                          <option key={column.id} value={column.id}>
                            {column.name} ({column.occupantCount}/{column.bedCapacity})
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                ))}
                <div className="muted" style={{ fontSize: "0.7rem", marginTop: "0.5rem", fontWeight: 600 }}>
                  Dorm leaders
                </div>
                {(dorm.dormLeaders ?? []).map((leader) => (
                  <div key={leader.id} className="assign-person-row">
                    <div
                      className="assign-person"
                      draggable
                      onDragStart={(event) => {
                        event.dataTransfer.setData(
                          dragMime,
                          JSON.stringify({ personKind: "dorm_leader", personId: leader.id }),
                        );
                        event.dataTransfer.effectAllowed = "move";
                      }}
                    >
                      {leader.firstName} {leader.lastName}{" "}
                      <span className="muted">({leader.gender})</span>
                    </div>
                    <label className="muted" style={{ fontSize: "0.75rem" }}>
                      Move to
                      <select
                        className="assign-move-select"
                        value={
                          leader.assignedCamperDormId &&
                          camperDorms.some((column) => column.id === leader.assignedCamperDormId)
                            ? leader.assignedCamperDormId
                            : ""
                        }
                        aria-label={`Move dorm leader ${leader.firstName} ${leader.lastName}`}
                        onChange={(event) => {
                          const value = event.target.value;
                          void postAssign("dorm_leader", leader.id, value === "" ? null : value);
                        }}
                      >
                        <option value="">Unassigned</option>
                        {camperDorms.map((column) => (
                          <option key={column.id} value={column.id}>
                            {column.name} ({column.occupantCount}/{column.bedCapacity})
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                ))}
              </div>
            ))}
            </div>
          </div>

          <h3 hidden={dormFilter === "camper"} className="muted" style={{ margin: "1rem 0 0", fontSize: "0.95rem" }}>
            Workers
          </h3>
          <div hidden={dormFilter === "camper"} className="assign-bench">
            <aside className="unassigned-rail" aria-label="Unassigned workers">
            <div
              className="assign-column"
              onDragOver={(event) => handleDragOverBench(event, "unassigned_worker")}
              onDrop={(event) => handleDropBench(event, "unassigned_worker")}
            >
              <div className="muted" style={{ fontWeight: 600 }}>
                Unassigned workers
              </div>
              {unassignedWorkers.filter((worker) => personMatchesSearch(worker.firstName, worker.lastName)).length === 0 ? <p className="dorm-empty">No unassigned workers.</p> : null}
              {unassignedWorkers.filter((worker) => personMatchesSearch(worker.firstName, worker.lastName)).map((worker) => (
                <div key={worker.id} className="assign-person-row">
                  <div
                    className="assign-person"
                    draggable
                    onDragStart={(event) => {
                      event.dataTransfer.setData(
                        dragMime,
                        JSON.stringify({ personKind: "worker", personId: worker.id }),
                      );
                      event.dataTransfer.effectAllowed = "move";
                    }}
                  >
                    {worker.firstName} {worker.lastName}{" "}
                    <span className="muted">({worker.gender})</span>
                  </div>
                  <label className="muted" style={{ fontSize: "0.75rem" }}>
                    Move to (keyboard)
                    <select
                      className="assign-move-select"
                      value={
                        worker.dormId && workerDorms.some((dorm) => dorm.id === worker.dormId)
                          ? worker.dormId
                          : ""
                      }
                      aria-label={`Move ${worker.firstName} ${worker.lastName}`}
                      onChange={(event) => {
                        const value = event.target.value;
                        void postAssign("worker", worker.id, value === "" ? null : value);
                      }}
                    >
                      <option value="">Unassigned</option>
                      {workerDorms.map((dorm) => (
                        <option key={dorm.id} value={dorm.id}>
                          {dorm.name} ({dorm.occupantCount}/{dorm.bedCapacity})
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              ))}
            </div>
            </aside>
            <div className="dorm-grid">
            {filteredWorkerDorms.length === 0 ? <p className="dorm-empty dorm-grid-empty">No worker dorms match this search.</p> : null}
            {filteredWorkerDorms.map((dorm) => (
              <div
                key={dorm.id}
                className="assign-column"
                onDragOver={(event) =>
                  handleDragOverBench(event, { dormPurpose: "worker", dormId: dorm.id })
                }
                onDrop={(event) => handleDropBench(event, { dormPurpose: "worker", dormId: dorm.id })}
              >
                <div className="dorm-card-header">
                  <div><strong>{dorm.name}</strong><div className="dorm-card-meta">{dorm.genderDesignation} · Worker dorm</div></div>
                  {superAdmin ? <div className="dorm-card-menu-wrap">
                    <button type="button" className="dorm-menu-button" aria-label={`Actions for ${dorm.name}`} aria-expanded={openDormMenuId === dorm.id} aria-haspopup="true" onClick={(event) => { event.stopPropagation(); setOpenDormMenuId(openDormMenuId === dorm.id ? null : dorm.id); }}>...</button>
                    {openDormMenuId === dorm.id ? <div className="dorm-card-menu" onClick={(event) => event.stopPropagation()}><button type="button" onClick={() => { beginEdit(dorm); setCreateDormOpen(false); setOpenDormMenuId(null); setActiveTab("inventory"); }}>Edit dorm</button></div> : null}
                  </div> : null}
                </div>
                <div className="dorm-capacity"><span>{dorm.occupantCount} assigned</span><strong>{dorm.occupantCount}/{dorm.bedCapacity}</strong></div>
                {dorm.workers.map((worker) => (
                  <div key={worker.id} className="assign-person-row">
                    <div
                      className="assign-person"
                      draggable
                      onDragStart={(event) => {
                        event.dataTransfer.setData(
                          dragMime,
                          JSON.stringify({ personKind: "worker", personId: worker.id }),
                        );
                        event.dataTransfer.effectAllowed = "move";
                      }}
                    >
                      {worker.firstName} {worker.lastName}{" "}
                      <span className="muted">({worker.gender})</span>
                    </div>
                    <label className="muted" style={{ fontSize: "0.75rem" }}>
                      Move to
                      <select
                        className="assign-move-select"
                        value={
                          worker.dormId && workerDorms.some((column) => column.id === worker.dormId)
                            ? worker.dormId
                            : ""
                        }
                        aria-label={`Move ${worker.firstName} ${worker.lastName}`}
                        onChange={(event) => {
                          const value = event.target.value;
                          void postAssign("worker", worker.id, value === "" ? null : value);
                        }}
                      >
                        <option value="">Unassigned</option>
                        {workerDorms.map((column) => (
                          <option key={column.id} value={column.id}>
                            {column.name} ({column.occupantCount}/{column.bedCapacity})
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                ))}
              </div>
            ))}
            </div>
          </div>
        </div>
      ) : null}

      {activeTab === "roster" && rosterOpen ? (
        <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) { setRosterOpen(false); setActiveTab("assignments"); } }}>
          <div ref={settingsDialogRef} className="modal-card stack dorm-roster-panel dorm-print-root" role="dialog" aria-modal="true" aria-labelledby="dorm-roster-title">
          <button type="button" className="dorm-dialog-close" aria-label="Close roster" onClick={() => { setRosterOpen(false); setActiveTab("assignments"); }}>X</button>
          <h2 id="dorm-roster-title" style={{ margin: 0 }}>Dorm roster</h2>
          <label className="stack">
            Dorm
            <select
              value={rosterDormId}
              onChange={(event) => {
                setRosterDormId(event.target.value);
                setRoster(null);
              }}
            >
              <option value="">Select a dorm…</option>
              {sortedDormsForRoster.map((dorm) => (
                <option key={dorm.id} value={dorm.id}>
                  {dorm.name} ({dorm.purpose})
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="btn secondary"
            disabled={!rosterDormId}
            onClick={() => void loadRoster()}
          >
            Refresh roster
          </button>
          <button type="button" className="btn primary" disabled={!roster || rosterLoading} onClick={() => window.print()}>
            Print roster
          </button>
          {rosterError ? <p className="error">{rosterError}</p> : null}
          {rosterLoading ? <p className="muted">Loading…</p> : null}
          {roster ? (
            <div className="stack">
              <p className="muted" style={{ margin: 0 }}>
                Capacity: {roster.occupantCount} / {roster.dorm.bedCapacity} beds · {roster.dorm.purpose} ·{" "}
                {roster.dorm.genderDesignation}
                {roster.dorm.ageGroupBracket
                  ? ` · Age group ${roster.dorm.ageGroupBracket.label} (${roster.dorm.ageGroupBracket.minAge}–${roster.dorm.ageGroupBracket.maxAge})`
                  : ""}
              </p>
              {roster.dormLeaders.length > 0 ? (
                <div>
                  <h3 style={{ marginBottom: "0.35rem" }}>Dorm leaders</h3>
                  <ul style={{ margin: 0, paddingLeft: "1.2rem" }}>
                    {roster.dormLeaders.map((leader) => (
                      <li key={leader.id}>
                        {leader.firstName} {leader.lastName} · {leader.phone} · {leader.checkInStatus}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {roster.campers && roster.campers.length > 0 ? (
                <div className="table-wrap">
                  <h3 style={{ marginBottom: "0.35rem" }}>Campers</h3>
                  <table>
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Age</th>
                        <th>Check-in</th>
                        <th>Guardian</th>
                        <th>Medical / dietary</th>
                      </tr>
                    </thead>
                    <tbody>
                      {roster.campers.map((camper) => (
                        <tr key={camper.id}>
                          <td>
                            {camper.firstName} {camper.lastName}
                          </td>
                          <td>{camper.age}</td>
                          <td>{camper.checkInStatus}</td>
                          <td>
                            {camper.guardianName}
                            <div className="muted">{camper.guardianPhone}</div>
                          </td>
                          <td>
                            {camper.medicalNotes ? <div>Medical: {camper.medicalNotes}</div> : null}
                            {camper.dietaryRestrictions ? (
                              <div>Dietary: {camper.dietaryRestrictions}</div>
                            ) : null}
                            {!camper.medicalNotes && !camper.dietaryRestrictions ? "—" : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
              {roster.workers && roster.workers.length > 0 ? (
                <div className="table-wrap">
                  <h3 style={{ marginBottom: "0.35rem" }}>Workers</h3>
                  <table>
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Age</th>
                        <th>Check-in</th>
                      </tr>
                    </thead>
                    <tbody>
                      {roster.workers.map((worker) => (
                        <tr key={worker.id}>
                          <td>
                            {worker.firstName} {worker.lastName}
                          </td>
                          <td>{worker.age ?? "—"}</td>
                          <td>{worker.checkInStatus}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
              {roster.medicalNotesSummaryLines.length > 0 ? (
                <div>
                  <h3 style={{ marginBottom: "0.35rem" }}>Medical notes summary</h3>
                  <ul style={{ margin: 0, paddingLeft: "1.2rem" }}>
                    {roster.medicalNotesSummaryLines.map((line, index) => (
                      <li key={`${index}-${line.slice(0, 24)}`}>{line}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
        </div>
      ) : null}

      {dormToDelete ? (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && deletingDormId === null) {
              setDormToDelete(null);
            }
          }}
        >
          <div
            className="card stack modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-dorm-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <h2 id="delete-dorm-title" style={{ marginTop: 0 }}>
              Delete dorm?
            </h2>
            <p style={{ margin: 0 }}>
              Delete <strong>{dormToDelete.name}</strong>? Assigned people will remain in this camp
              year and become unassigned.
            </p>
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <button
                type="button"
                className="btn secondary"
                disabled={deletingDormId !== null}
                onClick={() => setDormToDelete(null)}
              >
                Cancel
              </button>
              <button
                ref={deleteDormConfirmRef}
                type="button"
                className="btn danger"
                disabled={deletingDormId !== null}
                onClick={() => void handleDeleteDorm()}
              >
                {deletingDormId !== null ? "Deleting…" : "Delete dorm"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {camperAssignModal ? (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setCamperAssignModal(null);
            }
          }}
        >
          <div
            className="card stack modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="camper-assign-confirm-title"
            onMouseDown={(event) => {
              event.stopPropagation();
            }}
          >
            <h2 id="camper-assign-confirm-title" style={{ marginTop: 0 }}>
              Confirm assignment
            </h2>
            <p style={{ margin: 0 }}>
              Assign <strong>{camperAssignModal.camperLabel}</strong> to{" "}
              <strong>{camperAssignModal.dormLabel}</strong>? This does not match normal rules:
            </p>
            <ul style={{ margin: "0.5rem 0", paddingLeft: "1.25rem" }}>
              {camperAssignModal.messages.map((line, index) => (
                <li key={`${index}-${line.slice(0, 48)}`}>{line}</li>
              ))}
            </ul>
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <button
                type="button"
                className="btn secondary"
                onClick={() => setCamperAssignModal(null)}
              >
                Cancel
              </button>
              <button
                ref={camperAssignConfirmRef}
                type="button"
                className="btn"
                onClick={() => camperAssignModal.onConfirm()}
              >
                Confirm assignment
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
