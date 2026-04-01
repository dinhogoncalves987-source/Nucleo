// Tipos principais do sistema multi-tenant

export interface Tenant {
  id: string;
  name: string;
  created_at?: string;
}

export interface User {
  id: string;
  tenant_id: string;
  email: string;
  role: 'superadmin' | 'manager' | 'operator';
}

export interface Profile {
  id: string;
  tenant_id: string;
  email: string;
  role: 'superadmin' | 'manager' | 'operator';
  created_at?: string;
  tenants?: Tenant;
}

export interface Lead {
  id: string;
  tenant_id: string;
  name: string;
  phone: string;
  source: 'maps' | 'instagram' | 'csv' | 'manual' | 'inbound_whatsapp';
  status: 'new' | 'contacted' | 'qualified' | 'converted' | 'lost';
  validation_status: 'pending' | 'valid' | 'invalid';
  created_at?: string;
}

export interface Contact {
  id: string;
  tenant_id: string;
  name: string;
  phone: string;
  source: string;
  created_at?: string;
}

export interface KnowledgeBase {
  id: string;
  tenant_id: string;
  file_url: string;
  description: string;
  created_at?: string;
}

export interface ApiKey {
  id: string;
  tenant_id: string;
  service_name: string;
  api_key: string;
  webhook_url?: string;
}

export interface Campaign {
  id: string;
  tenant_id: string;
  message_template: string;
  send_interval_minutes: number;
  created_at?: string;
}

export interface Finance {
  id: string;
  tenant_id: string;
  amount: number;
  transaction_date: string;
}

export interface SystemMetric {
  id: string;
  tenant_id: string;
  cpu_usage: number;
  memory_usage: number;
  timestamp: string;
}

export interface SalesFunnelStage {
  id: string;
  tenant_id: string;
  name: string;
  order: number;
}

export interface ActivationMetric {
  id: string;
  campaign_id: string;
  contact_id: string;
  opened: boolean;
  scheduled: boolean;
  timestamp: string;
}
