export type HrAccessOutletContext = {
  hrStaff: boolean;
  sessionLoading: boolean;
};

export const defaultHrAccessContext: HrAccessOutletContext = {
  hrStaff: false,
  sessionLoading: true,
};
