export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      activities: {
        Row: {
          active: boolean
          created_at: string
          event_type: Database["public"]["Enums"]["event_type"]
          family_id: string
          id: string
          location: string | null
          name: string
          recurrence_rule: string | null
          schedule_label: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          event_type?: Database["public"]["Enums"]["event_type"]
          family_id: string
          id?: string
          location?: string | null
          name: string
          recurrence_rule?: string | null
          schedule_label?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          event_type?: Database["public"]["Enums"]["event_type"]
          family_id?: string
          id?: string
          location?: string | null
          name?: string
          recurrence_rule?: string | null
          schedule_label?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "activities_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      activity_members: {
        Row: {
          activity_id: string
          created_at: string
          family_member_id: string
        }
        Insert: {
          activity_id: string
          created_at?: string
          family_member_id: string
        }
        Update: {
          activity_id?: string
          created_at?: string
          family_member_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "activity_members_activity_id_fkey"
            columns: ["activity_id"]
            isOneToOne: false
            referencedRelation: "activities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_members_family_member_id_fkey"
            columns: ["family_member_id"]
            isOneToOne: false
            referencedRelation: "family_members"
            referencedColumns: ["id"]
          },
        ]
      }
      calendar_sources: {
        Row: {
          active: boolean
          created_at: string
          display_mode: Database["public"]["Enums"]["calendar_display_mode"]
          external_calendar_id: string | null
          family_id: string
          google_channel_expires_at: string | null
          google_channel_id: string | null
          google_channel_resource_id: string | null
          google_sync_token: string | null
          id: string
          is_main: boolean
          last_synced_at: string | null
          name: string
          provider: Database["public"]["Enums"]["calendar_provider"]
          selectable_in_email: boolean
          sort_order: number
          sync_error: string | null
          sync_failure_count: number
          sync_paused_at: string | null
          sync_status: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          display_mode?: Database["public"]["Enums"]["calendar_display_mode"]
          external_calendar_id?: string | null
          family_id: string
          google_channel_expires_at?: string | null
          google_channel_id?: string | null
          google_channel_resource_id?: string | null
          google_sync_token?: string | null
          id?: string
          is_main?: boolean
          last_synced_at?: string | null
          name: string
          provider?: Database["public"]["Enums"]["calendar_provider"]
          selectable_in_email?: boolean
          sort_order?: number
          sync_error?: string | null
          sync_failure_count?: number
          sync_paused_at?: string | null
          sync_status?: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          display_mode?: Database["public"]["Enums"]["calendar_display_mode"]
          external_calendar_id?: string | null
          family_id?: string
          google_channel_expires_at?: string | null
          google_channel_id?: string | null
          google_channel_resource_id?: string | null
          google_sync_token?: string | null
          id?: string
          is_main?: boolean
          last_synced_at?: string | null
          name?: string
          provider?: Database["public"]["Enums"]["calendar_provider"]
          selectable_in_email?: boolean
          sort_order?: number
          sync_error?: string | null
          sync_failure_count?: number
          sync_paused_at?: string | null
          sync_status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "calendar_sources_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      email_schedule_recipient_calendars: {
        Row: {
          calendar_source_id: string
          created_at: string
          recipient_id: string
        }
        Insert: {
          calendar_source_id: string
          created_at?: string
          recipient_id: string
        }
        Update: {
          calendar_source_id?: string
          created_at?: string
          recipient_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_schedule_recipient_calendars_calendar_source_id_fkey"
            columns: ["calendar_source_id"]
            isOneToOne: false
            referencedRelation: "calendar_sources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_schedule_recipient_calendars_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "email_schedule_recipients"
            referencedColumns: ["id"]
          },
        ]
      }
      email_schedule_recipients: {
        Row: {
          created_at: string
          email: string
          family_id: string
          family_member_id: string | null
          id: string
          name: string
          schedule_id: string
          unsubscribe_token: string
          unsubscribed_at: string | null
          updated_at: string
          user_id: string | null
          weekdays: string[]
        }
        Insert: {
          created_at?: string
          email: string
          family_id: string
          family_member_id?: string | null
          id?: string
          name: string
          schedule_id: string
          unsubscribe_token?: string
          unsubscribed_at?: string | null
          updated_at?: string
          user_id?: string | null
          weekdays?: string[]
        }
        Update: {
          created_at?: string
          email?: string
          family_id?: string
          family_member_id?: string | null
          id?: string
          name?: string
          schedule_id?: string
          unsubscribe_token?: string
          unsubscribed_at?: string | null
          updated_at?: string
          user_id?: string | null
          weekdays?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "email_schedule_recipients_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_schedule_recipients_family_member_id_fkey"
            columns: ["family_member_id"]
            isOneToOne: false
            referencedRelation: "family_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_schedule_recipients_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "email_schedules"
            referencedColumns: ["id"]
          },
        ]
      }
      email_schedules: {
        Row: {
          created_at: string
          created_by: string | null
          enabled: boolean
          family_id: string
          frequency: Database["public"]["Enums"]["email_summary_frequency"]
          id: string
          name: string
          send_time: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          enabled?: boolean
          family_id: string
          frequency?: Database["public"]["Enums"]["email_summary_frequency"]
          id?: string
          name: string
          send_time?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          enabled?: boolean
          family_id?: string
          frequency?: Database["public"]["Enums"]["email_summary_frequency"]
          id?: string
          name?: string
          send_time?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_schedules_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      email_summary_presyncs: {
        Row: {
          attempts: number
          completed_at: string | null
          created_at: string
          detail: string | null
          family_id: string
          id: string
          period_key: string
          schedule_id: string
          started_at: string
          status: string
        }
        Insert: {
          attempts?: number
          completed_at?: string | null
          created_at?: string
          detail?: string | null
          family_id: string
          id?: string
          period_key: string
          schedule_id: string
          started_at?: string
          status?: string
        }
        Update: {
          attempts?: number
          completed_at?: string | null
          created_at?: string
          detail?: string | null
          family_id?: string
          id?: string
          period_key?: string
          schedule_id?: string
          started_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_summary_presyncs_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_summary_presyncs_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "email_schedules"
            referencedColumns: ["id"]
          },
        ]
      }
      email_summary_sends: {
        Row: {
          created_at: string
          detail: string | null
          family_id: string
          id: string
          period_key: string
          recipient_id: string
          schedule_id: string
          status: string
        }
        Insert: {
          created_at?: string
          detail?: string | null
          family_id: string
          id?: string
          period_key: string
          recipient_id: string
          schedule_id: string
          status?: string
        }
        Update: {
          created_at?: string
          detail?: string | null
          family_id?: string
          id?: string
          period_key?: string
          recipient_id?: string
          schedule_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_summary_sends_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_summary_sends_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "email_schedule_recipients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_summary_sends_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "email_schedules"
            referencedColumns: ["id"]
          },
        ]
      }
      event_categories: {
        Row: {
          color: string
          created_at: string
          family_id: string
          id: string
          name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          color?: string
          created_at?: string
          family_id: string
          id?: string
          name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          color?: string
          created_at?: string
          family_id?: string
          id?: string
          name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_categories_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      event_members: {
        Row: {
          created_at: string
          event_id: string
          family_member_id: string
          weekdays: string[] | null
        }
        Insert: {
          created_at?: string
          event_id: string
          family_member_id: string
          weekdays?: string[] | null
        }
        Update: {
          created_at?: string
          event_id?: string
          family_member_id?: string
          weekdays?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "event_members_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_members_family_member_id_fkey"
            columns: ["family_member_id"]
            isOneToOne: false
            referencedRelation: "family_members"
            referencedColumns: ["id"]
          },
        ]
      }
      event_sync_links: {
        Row: {
          app_version: number
          branch_key: string
          calendar_source_id: string
          created_at: string
          event_id: string
          family_id: string
          google_etag: string | null
          google_event_id: string
          google_recurring_event_id: string | null
          google_updated_at: string | null
          id: string
          last_pushed_at: string | null
          last_source: string
          sync_error: string | null
          updated_at: string
        }
        Insert: {
          app_version?: number
          branch_key?: string
          calendar_source_id: string
          created_at?: string
          event_id: string
          family_id: string
          google_etag?: string | null
          google_event_id: string
          google_recurring_event_id?: string | null
          google_updated_at?: string | null
          id?: string
          last_pushed_at?: string | null
          last_source?: string
          sync_error?: string | null
          updated_at?: string
        }
        Update: {
          app_version?: number
          branch_key?: string
          calendar_source_id?: string
          created_at?: string
          event_id?: string
          family_id?: string
          google_etag?: string | null
          google_event_id?: string
          google_recurring_event_id?: string | null
          google_updated_at?: string | null
          id?: string
          last_pushed_at?: string | null
          last_source?: string
          sync_error?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_sync_links_calendar_source_id_fkey"
            columns: ["calendar_source_id"]
            isOneToOne: false
            referencedRelation: "calendar_sources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_sync_links_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_sync_links_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          all_day: boolean
          calendar_source_id: string | null
          category_id: string | null
          created_at: string
          created_by: string | null
          end_at: string
          event_type: Database["public"]["Enums"]["event_type"]
          excluded_dates: string[]
          external_event_id: string | null
          external_recurring_event_id: string | null
          family_id: string
          id: string
          last_change_source: string
          location: string | null
          needs_family_assignment: boolean
          notes: string | null
          recurrence_rule: string | null
          recurrence_until: string | null
          start_at: string
          title: string
          updated_at: string
        }
        Insert: {
          all_day?: boolean
          calendar_source_id?: string | null
          category_id?: string | null
          created_at?: string
          created_by?: string | null
          end_at: string
          event_type?: Database["public"]["Enums"]["event_type"]
          excluded_dates?: string[]
          external_event_id?: string | null
          external_recurring_event_id?: string | null
          family_id: string
          id?: string
          last_change_source?: string
          location?: string | null
          needs_family_assignment?: boolean
          notes?: string | null
          recurrence_rule?: string | null
          recurrence_until?: string | null
          start_at: string
          title: string
          updated_at?: string
        }
        Update: {
          all_day?: boolean
          calendar_source_id?: string | null
          category_id?: string | null
          created_at?: string
          created_by?: string | null
          end_at?: string
          event_type?: Database["public"]["Enums"]["event_type"]
          excluded_dates?: string[]
          external_event_id?: string | null
          external_recurring_event_id?: string | null
          family_id?: string
          id?: string
          last_change_source?: string
          location?: string | null
          needs_family_assignment?: boolean
          notes?: string | null
          recurrence_rule?: string | null
          recurrence_until?: string | null
          start_at?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "events_calendar_source_id_fkey"
            columns: ["calendar_source_id"]
            isOneToOne: false
            referencedRelation: "calendar_sources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "event_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      families: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          name: string
          timezone: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      family_invitations: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          created_at: string
          email: string
          expires_at: string
          family_id: string
          id: string
          invited_by: string | null
          role: Database["public"]["Enums"]["family_role"]
          status: Database["public"]["Enums"]["invitation_status"]
          token: string
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email: string
          expires_at?: string
          family_id: string
          id?: string
          invited_by?: string | null
          role?: Database["public"]["Enums"]["family_role"]
          status?: Database["public"]["Enums"]["invitation_status"]
          token?: string
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          family_id?: string
          id?: string
          invited_by?: string | null
          role?: Database["public"]["Enums"]["family_role"]
          status?: Database["public"]["Enums"]["invitation_status"]
          token?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "family_invitations_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      family_members: {
        Row: {
          access: Database["public"]["Enums"]["member_access"]
          active: boolean
          color: string
          created_at: string
          family_id: string
          id: string
          initial: string
          name: string
          role: Database["public"]["Enums"]["member_role"]
          sort_order: number
          updated_at: string
        }
        Insert: {
          access?: Database["public"]["Enums"]["member_access"]
          active?: boolean
          color?: string
          created_at?: string
          family_id: string
          id?: string
          initial: string
          name: string
          role?: Database["public"]["Enums"]["member_role"]
          sort_order?: number
          updated_at?: string
        }
        Update: {
          access?: Database["public"]["Enums"]["member_access"]
          active?: boolean
          color?: string
          created_at?: string
          family_id?: string
          id?: string
          initial?: string
          name?: string
          role?: Database["public"]["Enums"]["member_role"]
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "family_members_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      family_users: {
        Row: {
          created_at: string
          family_id: string
          family_member_id: string | null
          id: string
          role: Database["public"]["Enums"]["family_role"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          family_id: string
          family_member_id?: string | null
          id?: string
          role?: Database["public"]["Enums"]["family_role"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          family_id?: string
          family_member_id?: string | null
          id?: string
          role?: Database["public"]["Enums"]["family_role"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "family_users_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "family_users_family_member_id_fkey"
            columns: ["family_member_id"]
            isOneToOne: false
            referencedRelation: "family_members"
            referencedColumns: ["id"]
          },
        ]
      }
      google_connection_secrets: {
        Row: {
          connection_id: string
          connection_key_ciphertext: string
          created_at: string
          updated_at: string
        }
        Insert: {
          connection_id: string
          connection_key_ciphertext: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          connection_id?: string
          connection_key_ciphertext?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "google_connection_secrets_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: true
            referencedRelation: "google_connections"
            referencedColumns: ["id"]
          },
        ]
      }
      google_connections: {
        Row: {
          account_email: string
          connected_by: string | null
          created_at: string
          family_id: string
          google_account_id: string | null
          id: string
          last_error: string | null
          last_synced_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          account_email: string
          connected_by?: string | null
          created_at?: string
          family_id: string
          google_account_id?: string | null
          id?: string
          last_error?: string | null
          last_synced_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          account_email?: string
          connected_by?: string | null
          created_at?: string
          family_id?: string
          google_account_id?: string | null
          id?: string
          last_error?: string | null
          last_synced_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "google_connections_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      user_preferences: {
        Row: {
          created_at: string
          default_calendar_view: string
          updated_at: string
          user_id: string
          week_start: number
        }
        Insert: {
          created_at?: string
          default_calendar_view?: string
          updated_at?: string
          user_id: string
          week_start?: number
        }
        Update: {
          created_at?: string
          default_calendar_view?: string
          updated_at?: string
          user_id?: string
          week_start?: number
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      can_edit_family: { Args: { _family_id: string }; Returns: boolean }
      family_role_of: {
        Args: { _family_id: string }
        Returns: Database["public"]["Enums"]["family_role"]
      }
      has_family_access: { Args: { _family_id: string }; Returns: boolean }
      is_family_owner: { Args: { _family_id: string }; Returns: boolean }
    }
    Enums: {
      calendar_display_mode: "events" | "coverage_background"
      calendar_provider: "local" | "google"
      email_summary_frequency: "daily" | "weekly" | "monthly"
      event_type:
        | "school"
        | "activity"
        | "work"
        | "childcare"
        | "appointment"
        | "family"
        | "other"
        | "travel"
        | "birthday"
      family_role: "owner" | "editor" | "viewer"
      invitation_status: "pending" | "accepted" | "expired" | "revoked"
      member_access: "full" | "view_only"
      member_role: "parent" | "child" | "caregiver" | "other"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      calendar_display_mode: ["events", "coverage_background"],
      calendar_provider: ["local", "google"],
      email_summary_frequency: ["daily", "weekly", "monthly"],
      event_type: [
        "school",
        "activity",
        "work",
        "childcare",
        "appointment",
        "family",
        "other",
        "travel",
        "birthday",
      ],
      family_role: ["owner", "editor", "viewer"],
      invitation_status: ["pending", "accepted", "expired", "revoked"],
      member_access: ["full", "view_only"],
      member_role: ["parent", "child", "caregiver", "other"],
    },
  },
} as const
