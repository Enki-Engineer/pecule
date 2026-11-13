import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api.ts";
import { storeBirthdays } from "./theme.ts";
import type { Birthday } from "../lib/seasons.ts";

/**
 * Anniversaires du foyer (Réglages → Apparence) : gardés sur le serveur, partagés par les membres, et recopiés sur
 * chaque appareil pour que le thème « Anniversaire » s'applique dès l'ouverture, le jour J. La coquille de l'appli
 * appelle ce hook : un appareil qui n'ouvre jamais Réglages reçoit quand même la liste.
 */
export function useBirthdays() {
  const query = useQuery({ staleTime: 10 * 60_000, queryKey: ["birthdays"], queryFn: () => api<{ birthdays: Birthday[] }>("/birthdays").then((r) => r.birthdays) });
  const list = query.data;
  useEffect(() => {
    if (list) storeBirthdays(list);
  }, [list]);
  return query;
}

export function useSaveBirthdays() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (birthdays: Birthday[]) => api<{ birthdays: Birthday[] }>("/birthdays", { method: "PUT", json: { birthdays } }).then((r) => r.birthdays),
    onSuccess: (list) => qc.setQueryData(["birthdays"], list),
  });
}
