export type Role =
  | 'ceo'
  | 'admin'
  | 'superadmin'
  | 'manager'
  | 'commercial_director'
  | 'stock_central_maintainer'
  | 'cash_central_maintainer'
  | 'hr_admin'
  | 'franchise'
  | 'seller'
  | 'vendeur'
  | 'commercial'
  | 'siege_employee'
  | 'viewer';

export interface User {
  id: string;
  username: string;
  fullName: string;
  role: Role;
  franchiseId: string | null;
}

export type TimeLogType = 'entree' | 'sortie' | 'pause_debut' | 'pause_fin' | 'verif';

export interface NetworkPoint {
  _id: string;
  name: string;
  type: 'franchise' | 'activation' | 'recharge' | 'activation_recharge';
  status: 'prospect' | 'contact' | 'contrat_non_signe' | 'contrat_signe' | 'actif' | 'suspendu' | 'resilie';
  phone?: string;
  phone2?: string;
  email?: string;
  cin?: string;
  responsible?: string;
  responsibleFirstName?: string;
  responsibleLastName?: string;
  internalNotes?: string;
  address?: string;
  city?: string;
  governorate?: string;
  leadStatus?: 'lead' | 'contacted' | 'qualified' | 'contract_given' | 'won' | 'lost';
  documents?: {
    cinImagePath?: string | null;
    shopImagePath?: string | null;
    signaturePath?: string | null;
    signatureText?: string | null;
    infoSheetPdfPath?: string | null;
    signedAt?: string | null;
  };
  gps?: {
    lat?: number | null;
    lng?: number | null;
    accuracy?: number | null;
  };
}

export interface CommercialZone {
  _id: string;
  name: string;
  color?: string;
  polygon: Array<{ lat: number; lng: number }>;
}
