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
import {
  ageFitsGroup,
  formatAgeGroupRange,
  type AgeGroupBracket as AgeBracket,
} from "../ageGroups";
import { CampYearReadOnly } from "../components/CampYearReadOnly";
import { resolveCampYearSelection } from "../campYearSelection";

type CampYearOption = {
  id: string;
  name: string;
  yearLabel: string;
};

type DormRow = {
  id: string;
  name: string;
  purpose: "camper" | "worker";
  genderDesignation: "boys" | "girls" | "co_ed";
  bedCapacity: number;
  camperCapacity: number;
  leaderCapacity: number;
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
  workers: BoardWorker[];
  dormLeaders: BoardDormLeader[];
  occupantCount: number;
};

type BoardDormWorker = DormRow & {
  ageGroupBracket: AgeBracket | null;
  workers: BoardWorker[];
  occupantCount: number;
};

function isBoardCamperDorm(
  dorm: BoardDormCamper | BoardDormWorker,
): dorm is BoardDormCamper {
  return "dormLeaders" in dorm;
}

function boardCapacityForPerson(
  dorm: BoardDormCamper | BoardDormWorker,
  kind: "camper" | "dorm_leader" | "worker",
): string {
  if (isBoardCamperDorm(dorm)) {
    if (kind === "camper") {
      return `${dorm.campers.length}/${dorm.camperCapacity} campers`;
    }
    if (kind === "dorm_leader") {
      return `${dorm.dormLeaders.length}/${dorm.leaderCapacity} leaders`;
    }
  }
  return `${dorm.occupantCount}/${dorm.bedCapacity} beds`;
}
type BoardPersonPaletteItem = (
  | { kind: "camper"; person: BoardCamper }
  | { kind: "dorm_leader"; person: BoardDormLeader }
  | { kind: "worker"; person: BoardWorker }
) & {
  currentDormId: string | null;
  currentDormName: string | null;
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
    if (!ageFitsGroup(age, targetDorm.ageGroupBracket)) {
      messages.push(
        `This camper is age ${age} at camp start, outside this dorm's age group (${formatAgeGroupRange(targetDorm.ageGroupBracket)}). You can still save as an exception.`,
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
    camperCapacity: number;
    leaderCapacity: number;
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

type CapacityOverrideRequiredBody = {
  error: string;
  code: "capacity_override_required";
  capacityKind: "camper" | "leader" | "bed";
  currentCount: number;
  capacity: number;
  dormName: string;
};

function isCapacityOverrideRequiredBody(value: unknown): value is CapacityOverrideRequiredBody {
  return (
    typeof value === "object" &&
    value !== null &&
    "code" in value &&
    value.code === "capacity_override_required" &&
    "currentCount" in value &&
    typeof value.currentCount === "number" &&
    "capacity" in value &&
    typeof value.capacity === "number" &&
    "dormName" in value &&
    typeof value.dormName === "string"
  );
}

const dragMime = "application/x-byc-dorm-person";

type AssignPersonKind = "camper" | "worker" | "dorm_leader";

type AssignDropZone =
  | "unassigned"
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
  const [peopleGenderFilter, setPeopleGenderFilter] = useState<"all" | "male" | "female">("all");
  const [peopleRoleFilter, setPeopleRoleFilter] = useState<"all" | AssignPersonKind>("all");
  const [peopleAssignmentFilter, setPeopleAssignmentFilter] = useState<
    "all" | "assigned" | "unassigned"
  >("unassigned");
  const [peopleSearch, setPeopleSearch] = useState("");
  const [dormSearch, setDormSearch] = useState("");
  const [createDormOpen, setCreateDormOpen] = useState(false);
  const [openDormMenuId, setOpenDormMenuId] = useState<string | null>(null);
  const [rosterOpen, setRosterOpen] = useState(false);
  const settingsDialogRef = useRef<HTMLDivElement | null>(null);
  const dialogTriggerRef = useRef<HTMLElement | null>(null);
  const addDormButtonRef = useRef<HTMLButtonElement | null>(null);
  const openDormMenuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const activeDragKindRef = useRef<AssignPersonKind | null>(null);

  const [dorms, setDorms] = useState<DormRow[]>([]);
  const [brackets, setBrackets] = useState<AgeBracket[]>([]);
  const [inventoryError, setInventoryError] = useState<string | null>(null);
  const [inventoryLoading, setInventoryLoading] = useState(false);

  const [newName, setNewName] = useState("");
  const [newPurpose, setNewPurpose] = useState<"camper" | "worker">("camper");
  const [newGender, setNewGender] = useState<"boys" | "girls" | "co_ed">("boys");
  const [newCapacity, setNewCapacity] = useState("8");
  const [newCamperCapacity, setNewCamperCapacity] = useState("8");
  const [newLeaderCapacity, setNewLeaderCapacity] = useState("2");
  const [newBracketId, setNewBracketId] = useState("");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editPurpose, setEditPurpose] = useState<"camper" | "worker">("camper");
  const [editGender, setEditGender] = useState<"boys" | "girls" | "co_ed">("boys");
  const [editCapacity, setEditCapacity] = useState("");
  const [editCamperCapacity, setEditCamperCapacity] = useState("");
  const [editLeaderCapacity, setEditLeaderCapacity] = useState("");
  const [editBracketId, setEditBracketId] = useState("");
  const [deletingDormId, setDeletingDormId] = useState<string | null>(null);
  const [dormToDelete, setDormToDelete] = useState<DormRow | null>(null);
  const [deleteDormError, setDeleteDormError] = useState<string | null>(null);
  const deleteDormDialogRef = useRef<HTMLDivElement | null>(null);
  const deleteDormTriggerRef = useRef<HTMLButtonElement | null>(null);
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
  const [assignmentConfirmModal, setAssignmentConfirmModal] = useState<{
    personLabel: string;
    dormLabel: string;
    messages: string[];
    isCapacityOverride: boolean;
    onConfirm: () => void;
  } | null>(null);
  const assignmentConfirmRef = useRef<HTMLButtonElement | null>(null);

  const [rosterDormId, setRosterDormId] = useState("");
  const [roster, setRoster] = useState<RosterResponse | null>(null);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [rosterError, setRosterError] = useState<string | null>(null);

  const restoreFocus = useCallback((trigger: HTMLElement | null): void => {
    window.requestAnimationFrame(() => trigger?.focus());
  }, []);

  const closeActiveDialog = useCallback((): void => {
    const trigger = dialogTriggerRef.current;
    dialogTriggerRef.current = null;
    setCreateDormOpen(false);
    setEditingId(null);
    setRosterOpen(false);
    setActiveTab("assignments");
    restoreFocus(trigger);
  }, [restoreFocus]);

  const closeDeleteDialog = useCallback((): void => {
    const trigger = deleteDormTriggerRef.current;
    deleteDormTriggerRef.current = null;
    setDormToDelete(null);
    setDeleteDormError(null);
    window.requestAnimationFrame(() => {
      (trigger?.isConnected ? trigger : addDormButtonRef.current)?.focus();
    });
  }, []);
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
    const camperCapacityParsed = Number.parseInt(newCamperCapacity, 10);
    const leaderCapacityParsed = Number.parseInt(newLeaderCapacity, 10);
    if (newPurpose === "worker" && (Number.isNaN(capacityParsed) || capacityParsed < 1)) {
      setInventoryError("Bed capacity must be a positive integer.");
      return;
    }
    if (
      newPurpose === "camper" &&
      (Number.isNaN(camperCapacityParsed) || camperCapacityParsed < 1)
    ) {
      setInventoryError("Camper capacity must be a positive integer.");
      return;
    }
    if (
      newPurpose === "camper" &&
      (Number.isNaN(leaderCapacityParsed) || leaderCapacityParsed < 0)
    ) {
      setInventoryError("Leader capacity must be zero or a positive integer.");
      return;
    }
    try {
      await apiJson(`/api/admin/camp-years/${campYearId}/dorms`, {
        method: "POST",
        body: JSON.stringify({
          name: newName.trim(),
          purpose: newPurpose,
          genderDesignation: newGender,
          ...(newPurpose === "camper"
            ? {
                camperCapacity: camperCapacityParsed,
                leaderCapacity: leaderCapacityParsed,
              }
            : { bedCapacity: capacityParsed }),
          ageGroupBracketId:
            newPurpose === "camper" && newBracketId ? newBracketId : null,
        }),
      });
      setNewName("");
      setNewCapacity("8");
      setNewCamperCapacity("8");
      setNewLeaderCapacity("2");
      setNewBracketId("");
      await loadInventory();
      await loadBoard();
      closeActiveDialog();
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
    setEditCamperCapacity(String(dorm.camperCapacity));
    setEditLeaderCapacity(String(dorm.leaderCapacity));
    setEditBracketId(dorm.ageGroupBracketId ?? "");
  };

  const handleSaveEdit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!superAdmin || !campYearId || !editingId) {
      return;
    }
    setInventoryError(null);
    const capacityParsed = Number.parseInt(editCapacity, 10);
    const camperCapacityParsed = Number.parseInt(editCamperCapacity, 10);
    const leaderCapacityParsed = Number.parseInt(editLeaderCapacity, 10);
    if (editPurpose === "worker" && (Number.isNaN(capacityParsed) || capacityParsed < 1)) {
      setInventoryError("Bed capacity must be a positive integer.");
      return;
    }
    if (
      editPurpose === "camper" &&
      (Number.isNaN(camperCapacityParsed) || camperCapacityParsed < 1)
    ) {
      setInventoryError("Camper capacity must be a positive integer.");
      return;
    }
    if (
      editPurpose === "camper" &&
      (Number.isNaN(leaderCapacityParsed) || leaderCapacityParsed < 0)
    ) {
      setInventoryError("Leader capacity must be zero or a positive integer.");
      return;
    }
    try {
      await apiJson(`/api/admin/camp-years/${campYearId}/dorms/${editingId}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: editName.trim(),
          purpose: editPurpose,
          genderDesignation: editGender,
          ...(editPurpose === "camper"
            ? {
                camperCapacity: camperCapacityParsed,
                leaderCapacity: leaderCapacityParsed,
              }
            : { bedCapacity: capacityParsed }),
          ageGroupBracketId:
            editPurpose === "camper" && editBracketId ? editBracketId : null,
        }),
      });
      await loadInventory();
      await loadBoard();
      closeActiveDialog();
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Could not update dorm.";
      setInventoryError(message);
    }
  };

  useEffect(() => {
    if (!dormToDelete) return;
    const dialog = deleteDormDialogRef.current;
    const focusableSelector = "button:not([disabled]), [tabindex]:not([tabindex='-1'])";
    deleteDormConfirmRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape" && deletingDormId === null) {
        closeDeleteDialog();
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector));
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [closeDeleteDialog, deletingDormId, dormToDelete]);
  const handleDeleteDorm = async (): Promise<void> => {
    const dorm = dormToDelete;
    if (!superAdmin || !campYearId || !dorm) {
      return;
    }
    setDeleteDormError(null);
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

      await loadInventory();
      if (activeTab === "assignments") {
        await loadBoard();
      }
      closeDeleteDialog();
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Could not delete dorm.";
      setDeleteDormError(message);
    } finally {
      setDeletingDormId(null);
    }
  };

  const postAssign = async (
    personKind: AssignPersonKind,
    personId: string,
    dormId: string | null,
    capacityOverride = false,
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
          body: JSON.stringify({ personKind, personId, dormId, capacityOverride }),
        },
      );
      const lines = result.warnings ?? [];
      if (lines.length > 0) {
        setAssignMessage(lines.join(" "));
      }
      await loadBoard();
    } catch (caught) {
      const err = caught as ApiHttpError;
      if (
        err instanceof Error &&
        err.status === 409 &&
        isCapacityOverrideRequiredBody(err.body) &&
        dormId
      ) {
        const personLabel = findPersonLabel(personKind, personId);
        const capacityLabel =
          err.body.capacityKind === "camper"
            ? "campers"
            : err.body.capacityKind === "leader"
              ? "leaders"
              : "people";
        setAssignmentConfirmModal({
          personLabel,
          dormLabel: err.body.dormName,
          messages: [
            `${err.body.currentCount} ${capacityLabel} are already assigned and the configured maximum is ${err.body.capacity}.`,
            "Confirm to override the maximum capacity for this assignment.",
          ],
          isCapacityOverride: true,
          onConfirm: () => {
            setAssignmentConfirmModal(null);
            void postAssign(personKind, personId, dormId, true);
          },
        });
        return;
      }
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

  const findPersonLabel = (personKind: AssignPersonKind, personId: string): string => {
    if (personKind === "camper") {
      const camper = findCamperOnBoard(personId);
      return camper ? `${camper.firstName} ${camper.lastName}` : "this camper";
    }
    if (personKind === "dorm_leader") {
      const leader =
        unassignedDormLeaders.find((row) => row.id === personId) ??
        camperDorms.flatMap((dorm) => dorm.dormLeaders).find((row) => row.id === personId);
      return leader ? `${leader.firstName} ${leader.lastName}` : "this dorm leader";
    }
    const worker =
      unassignedWorkers.find((row) => row.id === personId) ??
      camperDorms.flatMap((dorm) => dorm.workers).find((row) => row.id === personId) ??
      workerDorms.flatMap((dorm) => dorm.workers).find((row) => row.id === personId);
    return worker ? `${worker.firstName} ${worker.lastName}` : "this worker";
  };

  const currentDormIdForPerson = (
    personKind: AssignPersonKind,
    personId: string,
  ): string | null | undefined => {
    if (personKind === "camper") {
      return findCamperOnBoard(personId)?.dormId;
    }
    if (personKind === "dorm_leader") {
      const leader =
        unassignedDormLeaders.find((row) => row.id === personId) ??
        camperDorms.flatMap((dorm) => dorm.dormLeaders).find((row) => row.id === personId);
      return leader?.assignedCamperDormId;
    }
    const worker =
      unassignedWorkers.find((row) => row.id === personId) ??
      camperDorms.flatMap((dorm) => dorm.workers).find((row) => row.id === personId) ??
      workerDorms.flatMap((dorm) => dorm.workers).find((row) => row.id === personId);
    return worker?.dormId;
  };

  const requestAssign = (
    personKind: AssignPersonKind,
    personId: string,
    dormId: string | null,
  ): void => {
    if (!campYearId) {
      return;
    }
    if (dormId === null) {
      void postAssign(personKind, personId, null);
      return;
    }
    if (currentDormIdForPerson(personKind, personId) === dormId) {
      return;
    }

    const targetDorm =
      camperDorms.find((dorm) => dorm.id === dormId) ??
      workerDorms.find((dorm) => dorm.id === dormId);
    if (!targetDorm) {
      void postAssign(personKind, personId, dormId);
      return;
    }

    const messages: string[] = [];
    const camper = findCamperOnBoard(personId);
    if (personKind === "camper" && camper && isBoardCamperDorm(targetDorm)) {
      messages.push(...camperAssignExceptionMessages(camper, targetDorm, boardCampStartIso));
    }

    let exceedsCapacity = false;
    if (personKind === "camper" && isBoardCamperDorm(targetDorm)) {
      exceedsCapacity = targetDorm.campers.length >= targetDorm.camperCapacity;
      if (exceedsCapacity) {
        messages.push(
          `${targetDorm.campers.length} campers are already assigned and the configured maximum is ${targetDorm.camperCapacity}. Confirm to override the maximum capacity.`,
        );
      }
    } else if (personKind === "dorm_leader" && isBoardCamperDorm(targetDorm)) {
      exceedsCapacity = targetDorm.dormLeaders.length >= targetDorm.leaderCapacity;
      if (exceedsCapacity) {
        messages.push(
          `${targetDorm.dormLeaders.length} leaders are already assigned and the configured maximum is ${targetDorm.leaderCapacity}. Confirm to override the maximum capacity.`,
        );
      }
    } else if (personKind === "worker") {
      exceedsCapacity = targetDorm.occupantCount >= targetDorm.bedCapacity;
      if (exceedsCapacity) {
        messages.push(
          `${targetDorm.occupantCount} people are already assigned and the configured maximum is ${targetDorm.bedCapacity}. Confirm to override the maximum capacity.`,
        );
      }
    }

    if (messages.length === 0) {
      void postAssign(personKind, personId, dormId);
      return;
    }

    setAssignmentConfirmModal({
      personLabel: findPersonLabel(personKind, personId),
      dormLabel: targetDorm.name,
      messages,
      isCapacityOverride: exceedsCapacity,
      onConfirm: () => {
        setAssignmentConfirmModal(null);
        void postAssign(personKind, personId, dormId, exceedsCapacity);
      },
    });
  };

  useEffect(() => {
    if (!assignmentConfirmModal) {
      return;
    }
    assignmentConfirmRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        setAssignmentConfirmModal(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [assignmentConfirmModal]);

  useEffect(() => {
    if (activeTab === "assignments") return;
    const dialog = settingsDialogRef.current;
const focusableSelector = "input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex='-1'])";
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        closeActiveDialog();
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector));
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.requestAnimationFrame(() => {
      const logicalFirst = dialog?.querySelector<HTMLElement>("input:not([disabled]), select:not([disabled]), textarea:not([disabled])");
      (logicalFirst ?? dialog)?.focus();
    });
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeTab, closeActiveDialog]);
  useEffect(() => {
    if (!openDormMenuId) return;
    const closeMenu = (): void => setOpenDormMenuId(null);
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        const trigger = openDormMenuTriggerRef.current;
        closeMenu();
        restoreFocus(trigger);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("click", closeMenu);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("click", closeMenu);
    };
  }, [openDormMenuId, restoreFocus]);
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
    if (zone === "unassigned") return true;
    if (personKind === "worker") return true;
    return zone.dormPurpose === "camper";
  };

  const beginPersonDrag = (
    event: DragEvent,
    personKind: AssignPersonKind,
    personId: string,
  ): void => {
    activeDragKindRef.current = personKind;
    event.dataTransfer.setData(dragMime, JSON.stringify({ personKind, personId }));
    event.dataTransfer.effectAllowed = "move";
  };

  const endPersonDrag = (): void => {
    activeDragKindRef.current = null;
  };

  const handleDragOverBench = (event: DragEvent, zone: AssignDropZone): void => {
    const personKind = activeDragKindRef.current;
    if (
      !personKind ||
      !Array.from(event.dataTransfer.types).includes(dragMime) ||
      !dropAccepts(personKind, zone)
    ) {
      event.dataTransfer.dropEffect = "none";
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  };

  const handleDropBench = (event: DragEvent, zone: AssignDropZone): void => {
    event.preventDefault();
    activeDragKindRef.current = null;
    const payload = parseDragPayload(event);
    if (!payload || !dropAccepts(payload.personKind, zone)) return;
    const dormId = zone === "unassigned" ? null : zone.dormId;
    requestAssign(payload.personKind, payload.personId, dormId);
  };
  const sortedDormsForRoster = useMemo(
    () => [...dorms].filter((dorm) => dorm.purpose === "camper").sort((left, right) => left.name.localeCompare(right.name)),
    [dorms],
  );

  const normalizedPeopleSearch = peopleSearch.trim().toLowerCase();
  const normalizedDormSearch = dormSearch.trim().toLowerCase();
  const visiblePeople = useMemo(() => {
    const peopleByKey = new Map<string, BoardPersonPaletteItem>();
    const addPerson = (item: BoardPersonPaletteItem): void => {
      peopleByKey.set(`${item.kind}:${item.person.id}`, item);
    };

    unassignedCampers.forEach((person) =>
      addPerson({ kind: "camper", person, currentDormId: null, currentDormName: null }),
    );
    unassignedDormLeaders.forEach((person) =>
      addPerson({ kind: "dorm_leader", person, currentDormId: null, currentDormName: null }),
    );
    unassignedWorkers.forEach((person) =>
      addPerson({ kind: "worker", person, currentDormId: null, currentDormName: null }),
    );
    camperDorms.forEach((dorm) => {
      dorm.campers.forEach((person) =>
        addPerson({ kind: "camper", person, currentDormId: dorm.id, currentDormName: dorm.name }),
      );
      dorm.dormLeaders.forEach((person) =>
        addPerson({ kind: "dorm_leader", person, currentDormId: dorm.id, currentDormName: dorm.name }),
      );
      dorm.workers.forEach((person) =>
        addPerson({ kind: "worker", person, currentDormId: dorm.id, currentDormName: dorm.name }),
      );
    });
    workerDorms.forEach((dorm) =>
      dorm.workers.forEach((person) =>
        addPerson({ kind: "worker", person, currentDormId: dorm.id, currentDormName: dorm.name }),
      ),
    );

    return [...peopleByKey.values()]
      .filter(({ kind }) => peopleRoleFilter === "all" || kind === peopleRoleFilter)
      .filter(
        ({ person }) =>
          peopleGenderFilter === "all" || person.gender === peopleGenderFilter,
      )
      .filter(({ currentDormId }) => {
        if (peopleAssignmentFilter === "assigned") {
          return currentDormId !== null;
        }
        if (peopleAssignmentFilter === "unassigned") {
          return currentDormId === null;
        }
        return true;
      })
      .filter(({ person }) =>
        `${person.firstName} ${person.lastName}`.toLowerCase().includes(normalizedPeopleSearch),
      )
      .sort((left, right) =>
        `${left.person.lastName} ${left.person.firstName}`.localeCompare(
          `${right.person.lastName} ${right.person.firstName}`,
        ),
      );
  }, [
    camperDorms,
    normalizedPeopleSearch,
    peopleAssignmentFilter,
    peopleGenderFilter,
    peopleRoleFilter,
    unassignedCampers,
    unassignedDormLeaders,
    unassignedWorkers,
    workerDorms,
  ]);
  const visibleCamperDorms = useMemo(
    () =>
      dormFilter === "worker"
        ? []
        : camperDorms.filter((dorm) => dorm.name.toLowerCase().includes(normalizedDormSearch)),
    [camperDorms, dormFilter, normalizedDormSearch],
  );
  const visibleWorkerDorms = useMemo(
    () =>
      dormFilter === "camper"
        ? []
        : workerDorms.filter((dorm) => dorm.name.toLowerCase().includes(normalizedDormSearch)),
    [dormFilter, normalizedDormSearch, workerDorms],
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
          <button ref={addDormButtonRef} type="button" className="btn primary dorm-add-button" onClick={(event) => { dialogTriggerRef.current = event.currentTarget; setCreateDormOpen(true); setActiveTab("inventory"); }}>
            Add new dorm
          </button>
        ) : null}
      </header>

      <div className="dorm-toolbar" aria-label="Dorm board controls">
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
        <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeActiveDialog(); }}>
          <div ref={settingsDialogRef} tabIndex={-1} className="modal-card stack dorm-settings-dialog" role="dialog" aria-modal="true" aria-labelledby={createDormOpen ? "create-dorm-title" : "edit-dorm-title"}>
          <button type="button" className="dorm-dialog-close" aria-label="Close dorm settings" onClick={closeActiveDialog}>X</button>
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
              {newPurpose === "camper" ? (
                <>
                  <label className="stack">
                    Camper capacity
                    <input
                      type="number"
                      min={1}
                      value={newCamperCapacity}
                      onChange={(event) => setNewCamperCapacity(event.target.value)}
                      required
                    />
                  </label>
                  <label className="stack">
                    Leader capacity
                    <input
                      type="number"
                      min={0}
                      value={newLeaderCapacity}
                      onChange={(event) => setNewLeaderCapacity(event.target.value)}
                      required
                    />
                  </label>
                </>
              ) : (
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
              )}
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
                        {formatAgeGroupRange(bracket)}
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
              {editPurpose === "camper" ? (
                <>
                  <label className="stack">
                    Camper capacity
                    <input
                      type="number"
                      min={1}
                      value={editCamperCapacity}
                      onChange={(event) => setEditCamperCapacity(event.target.value)}
                      required
                    />
                  </label>
                  <label className="stack">
                    Leader capacity
                    <input
                      type="number"
                      min={0}
                      value={editLeaderCapacity}
                      onChange={(event) => setEditLeaderCapacity(event.target.value)}
                      required
                    />
                  </label>
                </>
              ) : (
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
              )}
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
                        {formatAgeGroupRange(bracket)}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <div className="row">
                <button type="submit" className="btn">
                  Save
                </button>
                <button type="button" className="btn secondary" onClick={() => { closeActiveDialog(); }}>
                  Cancel
                </button>
              </div>
            </form>
          ) : null}
        </div>
        </div>
      ) : null}

      {activeTab === "assignments" ? (
        <section className="card stack dorm-assignment-board" aria-labelledby="assignment-board-title">
          <h2 id="assignment-board-title" className="sr-only">Assignment board</h2>
          {boardError ? <p className="error">{boardError}</p> : null}
          {assignMessage ? <p className="muted" role="status">{assignMessage}</p> : null}
          {boardLoading ? <p className="muted">Loading board...</p> : null}
          <div className="assign-bench">
            <aside className="unassigned-rail assign-panel" aria-labelledby="people-panel-title" onDragOver={(event) => handleDragOverBench(event, "unassigned")} onDrop={(event) => handleDropBench(event, "unassigned")}>
              <div className="assign-panel-header">
                <div><p className="dorm-eyebrow">People</p><h3 id="people-panel-title">All people</h3></div>
                <span className="assign-count">{visiblePeople.length}</span>
              </div>
              <label className="assign-panel-search"><span className="sr-only">Search all people</span><input type="search" placeholder="Search people..." value={peopleSearch} onChange={(event) => setPeopleSearch(event.target.value)} /></label>
              <div className="people-filter-grid" aria-label="Filter people">
                <label className="assign-panel-filter">
                  <span>Gender</span>
                  <select value={peopleGenderFilter} onChange={(event) => setPeopleGenderFilter(event.target.value as "all" | "male" | "female")}>
                    <option value="all">All genders</option>
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                  </select>
                </label>
                <label className="assign-panel-filter">
                  <span>Role</span>
                  <select value={peopleRoleFilter} onChange={(event) => setPeopleRoleFilter(event.target.value as "all" | AssignPersonKind)}>
                    <option value="all">All roles</option>
                    <option value="camper">Campers</option>
                    <option value="dorm_leader">Dorm leaders</option>
                    <option value="worker">Workers</option>
                  </select>
                </label>
                <label className="assign-panel-filter">
                  <span>Assignment</span>
                  <select value={peopleAssignmentFilter} onChange={(event) => setPeopleAssignmentFilter(event.target.value as "all" | "assigned" | "unassigned")}>
                    <option value="all">All assignments</option>
                    <option value="assigned">Assigned</option>
                    <option value="unassigned">Unassigned</option>
                  </select>
                </label>
              </div>
              <div className="unassigned-people-list">
                {visiblePeople.length === 0 ? <p className="dorm-empty">No people match these filters.</p> : null}
                {visiblePeople.map(({ kind, person, currentDormId, currentDormName }) => {
                  const targetDorms = kind === "worker" ? [...camperDorms, ...workerDorms] : camperDorms;
                  const detail = kind === "camper" ? camperBoardDetailLine(person, boardCampStartIso) : person.gender;
                  const kindLabel = kind === "dorm_leader" ? "Dorm leader" : kind === "camper" ? "Camper" : "Worker";
                  return <div key={`${kind}-${person.id}`} className="assign-person-row">
                    <div className="assign-person" draggable onDragStart={(event) => beginPersonDrag(event, kind, person.id)} onDragEnd={endPersonDrag}>
                      <div className="assign-person-name">{person.firstName} {person.lastName}</div>
                      <div className="assign-person-meta"><span className={`person-kind person-kind-${kind}`}>{kindLabel}</span><span>{detail}</span><span>{currentDormName ? `Assigned to ${currentDormName}` : "Unassigned"}</span></div>
                    </div>
                    <label className="muted assign-move-label">Move to (keyboard)<select className="assign-move-select" value={currentDormId ?? ""} aria-label={`Move ${person.firstName} ${person.lastName}`} onChange={(event) => { const dormId = event.target.value || null; requestAssign(kind, person.id, dormId); }}><option value="">Unassigned</option>{targetDorms.map((dorm) => <option key={dorm.id} value={dorm.id}>{dorm.name} ({boardCapacityForPerson(dorm, kind)})</option>)}</select></label>
                  </div>;
                })}
              </div>
            </aside>
            <section className="dorm-grid-panel assign-panel" aria-labelledby="dorm-panel-title">
              <div className="assign-panel-header dorm-panel-header">
                <div><p className="dorm-eyebrow">Housing</p><h3 id="dorm-panel-title">Dorms</h3></div>
                <div className="dorm-panel-controls">
                  <label className="assign-panel-search"><span className="sr-only">Search dorms</span><input type="search" placeholder="Search dorms..." value={dormSearch} onChange={(event) => setDormSearch(event.target.value)} /></label>
                  <label className="assign-panel-filter"><span className="sr-only">Filter dorms</span><select value={dormFilter} onChange={(event) => setDormFilter(event.target.value as "all" | "camper" | "worker")}><option value="all">All dorms</option><option value="camper">Camper dorms</option><option value="worker">Worker dorms</option></select></label>
                </div>
              </div>
              <div className="dorm-grid">
                {visibleCamperDorms.length + visibleWorkerDorms.length === 0 ? <p className="dorm-empty dorm-grid-empty">No dorms match these filters.</p> : null}
                {[...visibleCamperDorms, ...visibleWorkerDorms].map((dorm) => {
                  const isCamperDorm = isBoardCamperDorm(dorm);
                  const occupants: Array<{ kind: "camper"; person: BoardCamper } | { kind: "dorm_leader"; person: BoardDormLeader } | { kind: "worker"; person: BoardWorker }> = isCamperDorm ? [...dorm.campers.map((person) => ({ kind: "camper" as const, person })), ...dorm.dormLeaders.map((person) => ({ kind: "dorm_leader" as const, person })), ...dorm.workers.map((person) => ({ kind: "worker" as const, person }))] : dorm.workers.map((person) => ({ kind: "worker" as const, person }));
                  return <article key={dorm.id} className="assign-column" onDragOver={(event) => handleDragOverBench(event, { dormPurpose: dorm.purpose, dormId: dorm.id })} onDrop={(event) => handleDropBench(event, { dormPurpose: dorm.purpose, dormId: dorm.id })}>
                    <div className="dorm-card-header">
                      <div><strong>{dorm.name}</strong><div className="dorm-card-meta">{dorm.genderDesignation} | {isCamperDorm ? "Camper" : "Worker"} dorm</div></div>
                      {(superAdmin || isCamperDorm) ? <div className="dorm-card-menu-wrap">
                        <button type="button" className="dorm-menu-button" aria-label={`Actions for ${dorm.name}`} aria-expanded={openDormMenuId === dorm.id} aria-haspopup="true" onClick={(event) => { event.stopPropagation(); openDormMenuTriggerRef.current = event.currentTarget; setOpenDormMenuId(openDormMenuId === dorm.id ? null : dorm.id); }}>...</button>
                        {openDormMenuId === dorm.id ? <div className="dorm-card-menu" onClick={(event) => event.stopPropagation()}>
                          {superAdmin ? <><button type="button" onClick={(event) => { dialogTriggerRef.current = event.currentTarget.closest(".dorm-card-menu-wrap")?.querySelector<HTMLElement>(".dorm-menu-button") ?? event.currentTarget; beginEdit(dorm); setCreateDormOpen(false); setOpenDormMenuId(null); setActiveTab("inventory"); }}>Edit dorm</button><button type="button" onClick={() => { deleteDormTriggerRef.current = openDormMenuTriggerRef.current; setDeleteDormError(null); setOpenDormMenuId(null); setDormToDelete(dorm); }}>Delete dorm</button></> : null}
                          {isCamperDorm ? <button type="button" onClick={(event) => { dialogTriggerRef.current = event.currentTarget.closest(".dorm-card-menu-wrap")?.querySelector<HTMLElement>(".dorm-menu-button") ?? event.currentTarget; setRosterDormId(dorm.id); setRosterOpen(true); setOpenDormMenuId(null); setActiveTab("roster"); }}>Printable roster</button> : null}
                        </div> : null}
                      </div> : null}
                    </div>
                    <div className="dorm-capacity">
                      {isCamperDorm ? (
                        <>
                          <span>{dorm.campers.length}/{dorm.camperCapacity} campers</span>
                          <strong>{dorm.dormLeaders.length}/{dorm.leaderCapacity} leaders</strong>
                        </>
                      ) : (
                        <>
                          <span>{dorm.occupantCount} assigned</span>
                          <strong>{dorm.occupantCount}/{dorm.bedCapacity}</strong>
                        </>
                      )}
                    </div>
                    <div className="dorm-occupant-list">
                      {occupants.length === 0 ? <p className="dorm-empty">Drop {isCamperDorm ? "campers, workers, or dorm leaders" : "workers"} here.</p> : null}
                      {occupants.map(({ kind, person }) => <div key={`${kind}-${person.id}`} className="assign-person-row">
                        <div className="assign-person" draggable onDragStart={(event) => beginPersonDrag(event, kind, person.id)} onDragEnd={endPersonDrag}><div className="assign-person-name">{person.firstName} {person.lastName}</div><div className="assign-person-meta"><span className={`person-kind person-kind-${kind}`}>{kind === "dorm_leader" ? "Dorm leader" : kind === "camper" ? "Camper" : "Worker"}</span><span>{person.gender}</span></div></div>
                        <label className="muted assign-move-label">Move to<select className="assign-move-select" value={kind === "dorm_leader" ? person.assignedCamperDormId ?? "" : person.dormId ?? ""} aria-label={`Move ${person.firstName} ${person.lastName}`} onChange={(event) => { const dormId = event.target.value || null; requestAssign(kind, person.id, dormId); }}><option value="">Unassigned</option>{(kind === "worker" ? [...camperDorms, ...workerDorms] : camperDorms).map((target) => <option key={target.id} value={target.id}>{target.name} ({boardCapacityForPerson(target, kind)})</option>)}</select></label>
                      </div>)}
                    </div>
                  </article>;
                })}
              </div>
            </section>
          </div>
        </section>
      ) : null}
      {activeTab === "roster" && rosterOpen ? (
        <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeActiveDialog(); }}>
          <div ref={settingsDialogRef} tabIndex={-1} className="modal-card stack dorm-roster-panel dorm-print-root" role="dialog" aria-modal="true" aria-labelledby="dorm-roster-title">
          <button type="button" className="dorm-dialog-close" aria-label="Close roster" onClick={closeActiveDialog}>X</button>
          <h2 id="dorm-roster-title" style={{ margin: 0 }}>
            Dorm roster{roster ? ` - ${roster.dorm.name}` : ""}
          </h2>
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
                {roster.dorm.purpose === "camper"
                  ? `Capacity: ${roster.campers?.length ?? 0} / ${roster.dorm.camperCapacity} campers · ${roster.dormLeaders.length} / ${roster.dorm.leaderCapacity} leaders`
                  : `Capacity: ${roster.occupantCount} / ${roster.dorm.bedCapacity} beds`}{" "}
                · {roster.dorm.purpose} ·{" "}
                {roster.dorm.genderDesignation}
                {roster.dorm.ageGroupBracket
                  ? ` · Age group ${formatAgeGroupRange(roster.dorm.ageGroupBracket)}`
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
                      <tr className="dorm-print-page-title-row">
                        <th colSpan={5}>Dorm roster{roster ? ` - ${roster.dorm.name}` : ""}</th>
                      </tr>
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
                      <tr className="dorm-print-page-title-row">
                        <th colSpan={5}>Dorm roster{roster ? ` - ${roster.dorm.name}` : ""}</th>
                      </tr>
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
              closeDeleteDialog();
            }
          }}
        >
          <div
            ref={deleteDormDialogRef}
            tabIndex={-1}
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
            {deleteDormError ? <p className="error" role="alert" aria-live="assertive">{deleteDormError}</p> : null}
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <button
                type="button"
                className="btn secondary"
                disabled={deletingDormId !== null}
                ref={deleteDormConfirmRef}
                onClick={closeDeleteDialog}
              >
                Cancel
              </button>
              <button
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

      {assignmentConfirmModal ? (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setAssignmentConfirmModal(null);
            }
          }}
        >
          <div
            className="card stack modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="assignment-confirm-title"
            onMouseDown={(event) => {
              event.stopPropagation();
            }}
          >
            <h2 id="assignment-confirm-title" style={{ marginTop: 0 }}>
              {assignmentConfirmModal.isCapacityOverride
                ? "Capacity warning"
                : "Confirm assignment"}
            </h2>
            <p style={{ margin: 0 }}>
              Assign <strong>{assignmentConfirmModal.personLabel}</strong> to{" "}
              <strong>{assignmentConfirmModal.dormLabel}</strong>?
            </p>
            <ul style={{ margin: "0.5rem 0", paddingLeft: "1.25rem" }}>
              {assignmentConfirmModal.messages.map((line, index) => (
                <li key={`${index}-${line.slice(0, 48)}`}>{line}</li>
              ))}
            </ul>
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <button
                type="button"
                className="btn secondary"
                onClick={() => setAssignmentConfirmModal(null)}
              >
                Cancel
              </button>
              <button
                ref={assignmentConfirmRef}
                type="button"
                className="btn"
                onClick={() => assignmentConfirmModal.onConfirm()}
              >
                {assignmentConfirmModal.isCapacityOverride
                  ? "Override capacity"
                  : "Confirm assignment"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
