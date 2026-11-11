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
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      account_deletion_jobs: {
        Row: {
          attempt_id: string | null
          attempts: number
          created_at: string
          google_revoke_failures: number
          last_error: string | null
          lease_expires_at: string | null
          sign_in_restored: boolean
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          attempt_id?: string | null
          attempts?: number
          created_at?: string
          google_revoke_failures?: number
          last_error?: string | null
          lease_expires_at?: string | null
          sign_in_restored?: boolean
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          attempt_id?: string | null
          attempts?: number
          created_at?: string
          google_revoke_failures?: number
          last_error?: string | null
          lease_expires_at?: string | null
          sign_in_restored?: boolean
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
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
      app_tour_states: {
        Row: {
          status: string
          tour_version: number
          updated_at: string
          user_id: string
        }
        Insert: {
          status: string
          tour_version: number
          updated_at?: string
          user_id: string
        }
        Update: {
          status?: string
          tour_version?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      auth_lookup_attempts: {
        Row: {
          bucket: string
          created_at: string
          id: number
        }
        Insert: {
          bucket: string
          created_at?: string
          id?: never
        }
        Update: {
          bucket?: string
          created_at?: string
          id?: never
        }
        Relationships: []
      }
      babysitter_access_calendars: {
        Row: {
          calendar_source_id: string
          created_at: string
          family_user_id: string
        }
        Insert: {
          calendar_source_id: string
          created_at?: string
          family_user_id: string
        }
        Update: {
          calendar_source_id?: string
          created_at?: string
          family_user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "babysitter_access_calendars_calendar_source_id_fkey"
            columns: ["calendar_source_id"]
            isOneToOne: false
            referencedRelation: "calendar_sources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "babysitter_access_calendars_family_user_id_fkey"
            columns: ["family_user_id"]
            isOneToOne: false
            referencedRelation: "babysitter_access_profiles"
            referencedColumns: ["family_user_id"]
          },
        ]
      }
      babysitter_access_profiles: {
        Row: {
          created_at: string
          date_scope: Database["public"]["Enums"]["babysitter_date_scope"]
          family_id: string
          family_user_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          date_scope?: Database["public"]["Enums"]["babysitter_date_scope"]
          family_id: string
          family_user_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          date_scope?: Database["public"]["Enums"]["babysitter_date_scope"]
          family_id?: string
          family_user_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "babysitter_access_profiles_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "babysitter_access_profiles_family_user_id_fkey"
            columns: ["family_user_id"]
            isOneToOne: true
            referencedRelation: "family_users"
            referencedColumns: ["id"]
          },
        ]
      }
      babysitter_coverage_settings: {
        Row: {
          buffer_after_minutes: number
          buffer_before_minutes: number
          family_id: string
          parent_one_label: string
          parent_one_source_id: string | null
          parent_two_label: string
          parent_two_source_id: string | null
          updated_at: string
        }
        Insert: {
          buffer_after_minutes?: number
          buffer_before_minutes?: number
          family_id: string
          parent_one_label?: string
          parent_one_source_id?: string | null
          parent_two_label?: string
          parent_two_source_id?: string | null
          updated_at?: string
        }
        Update: {
          buffer_after_minutes?: number
          buffer_before_minutes?: number
          family_id?: string
          parent_one_label?: string
          parent_one_source_id?: string | null
          parent_two_label?: string
          parent_two_source_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "babysitter_coverage_settings_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: true
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "babysitter_coverage_settings_parent_one_source_id_fkey"
            columns: ["parent_one_source_id"]
            isOneToOne: false
            referencedRelation: "calendar_sources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "babysitter_coverage_settings_parent_two_source_id_fkey"
            columns: ["parent_two_source_id"]
            isOneToOne: false
            referencedRelation: "calendar_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      babysitter_schedule_drafts: {
        Row: {
          content: Json
          family_id: string
          id: string
          month: string
          revision: number
          updated_at: string
        }
        Insert: {
          content?: Json
          family_id: string
          id?: string
          month: string
          revision?: number
          updated_at?: string
        }
        Update: {
          content?: Json
          family_id?: string
          id?: string
          month?: string
          revision?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "babysitter_schedule_drafts_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      babysitter_schedule_publish_ops: {
        Row: {
          attempts: number
          created_at: string
          draft_id: string
          draft_revision: number
          draft_shift_id: string
          event_id: string | null
          family_id: string
          google_status: string
          id: string
          kind: string
          last_error: string | null
          op_key: string
          payload: Json
          run_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          draft_id: string
          draft_revision: number
          draft_shift_id: string
          event_id?: string | null
          family_id: string
          google_status?: string
          id?: string
          kind: string
          last_error?: string | null
          op_key: string
          payload: Json
          run_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          created_at?: string
          draft_id?: string
          draft_revision?: number
          draft_shift_id?: string
          event_id?: string | null
          family_id?: string
          google_status?: string
          id?: string
          kind?: string
          last_error?: string | null
          op_key?: string
          payload?: Json
          run_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "babysitter_schedule_publish_ops_draft_id_fkey"
            columns: ["draft_id"]
            isOneToOne: false
            referencedRelation: "babysitter_schedule_drafts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "babysitter_schedule_publish_ops_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "babysitter_schedule_publish_ops_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "babysitter_schedule_publish_ops_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "babysitter_schedule_publish_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      babysitter_schedule_publish_previews: {
        Row: {
          created_at: string
          created_by: string
          draft_id: string
          draft_revision: number
          event_versions: Json
          family_id: string
          id: string
          plan: Json
        }
        Insert: {
          created_at?: string
          created_by: string
          draft_id: string
          draft_revision: number
          event_versions: Json
          family_id: string
          id?: string
          plan: Json
        }
        Update: {
          created_at?: string
          created_by?: string
          draft_id?: string
          draft_revision?: number
          event_versions?: Json
          family_id?: string
          id?: string
          plan?: Json
        }
        Relationships: [
          {
            foreignKeyName: "babysitter_schedule_publish_previews_draft_id_fkey"
            columns: ["draft_id"]
            isOneToOne: false
            referencedRelation: "babysitter_schedule_drafts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "babysitter_schedule_publish_previews_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      babysitter_schedule_publish_runs: {
        Row: {
          completed_at: string | null
          created_at: string
          draft_id: string
          draft_revision: number
          family_id: string
          id: string
          month: string
          started_by: string | null
          status: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          draft_id: string
          draft_revision: number
          family_id: string
          id?: string
          month: string
          started_by?: string | null
          status?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          draft_id?: string
          draft_revision?: number
          family_id?: string
          id?: string
          month?: string
          started_by?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "babysitter_schedule_publish_runs_draft_id_fkey"
            columns: ["draft_id"]
            isOneToOne: false
            referencedRelation: "babysitter_schedule_drafts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "babysitter_schedule_publish_runs_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      babysitter_schedule_templates: {
        Row: {
          content: Json
          family_id: string
          id: string
          name: string
          revision: number
          updated_at: string
        }
        Insert: {
          content: Json
          family_id: string
          id?: string
          name: string
          revision?: number
          updated_at?: string
        }
        Update: {
          content?: Json
          family_id?: string
          id?: string
          name?: string
          revision?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "babysitter_schedule_templates_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      babysitter_shifts: {
        Row: {
          assignee_member_id: string | null
          assignee_name: string | null
          assignment: string
          created_at: string
          event_id: string
          family_id: string
          family_user_id: string | null
          id: string
        }
        Insert: {
          assignee_member_id?: string | null
          assignee_name?: string | null
          assignment?: string
          created_at?: string
          event_id: string
          family_id: string
          family_user_id?: string | null
          id?: string
        }
        Update: {
          assignee_member_id?: string | null
          assignee_name?: string | null
          assignment?: string
          created_at?: string
          event_id?: string
          family_id?: string
          family_user_id?: string | null
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "babysitter_shifts_assignee_member_id_fkey"
            columns: ["assignee_member_id"]
            isOneToOne: false
            referencedRelation: "family_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "babysitter_shifts_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "babysitter_shifts_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "babysitter_shifts_family_user_id_fkey"
            columns: ["family_user_id"]
            isOneToOne: false
            referencedRelation: "babysitter_access_profiles"
            referencedColumns: ["family_user_id"]
          },
        ]
      }
      calendar_sources: {
        Row: {
          active: boolean
          app_managed_calendar: boolean
          calendar_kind: string
          color: string | null
          created_at: string
          display_icon: string | null
          display_mode: Database["public"]["Enums"]["calendar_display_mode"]
          external_calendar_id: string | null
          family_id: string
          google_channel_expires_at: string | null
          google_channel_id: string | null
          google_channel_last_notified_at: string | null
          google_channel_resource_id: string | null
          google_sync_token: string | null
          google_time_zone: string | null
          id: string
          is_main: boolean
          last_synced_at: string | null
          name: string
          provider: Database["public"]["Enums"]["calendar_provider"]
          selectable_in_email: boolean
          sort_order: number
          subscription_member_id: string | null
          sync_error: string | null
          sync_failure_count: number
          sync_paused_at: string | null
          sync_status: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          app_managed_calendar?: boolean
          calendar_kind?: string
          color?: string | null
          created_at?: string
          display_icon?: string | null
          display_mode?: Database["public"]["Enums"]["calendar_display_mode"]
          external_calendar_id?: string | null
          family_id: string
          google_channel_expires_at?: string | null
          google_channel_id?: string | null
          google_channel_last_notified_at?: string | null
          google_channel_resource_id?: string | null
          google_sync_token?: string | null
          google_time_zone?: string | null
          id?: string
          is_main?: boolean
          last_synced_at?: string | null
          name: string
          provider?: Database["public"]["Enums"]["calendar_provider"]
          selectable_in_email?: boolean
          sort_order?: number
          subscription_member_id?: string | null
          sync_error?: string | null
          sync_failure_count?: number
          sync_paused_at?: string | null
          sync_status?: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          app_managed_calendar?: boolean
          calendar_kind?: string
          color?: string | null
          created_at?: string
          display_icon?: string | null
          display_mode?: Database["public"]["Enums"]["calendar_display_mode"]
          external_calendar_id?: string | null
          family_id?: string
          google_channel_expires_at?: string | null
          google_channel_id?: string | null
          google_channel_last_notified_at?: string | null
          google_channel_resource_id?: string | null
          google_sync_token?: string | null
          google_time_zone?: string | null
          id?: string
          is_main?: boolean
          last_synced_at?: string | null
          name?: string
          provider?: Database["public"]["Enums"]["calendar_provider"]
          selectable_in_email?: boolean
          sort_order?: number
          subscription_member_id?: string | null
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
          {
            foreignKeyName: "calendar_sources_subscription_member_id_fkey"
            columns: ["subscription_member_id"]
            isOneToOne: false
            referencedRelation: "family_members"
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
          content_mode: string
          created_at: string
          email: string
          family_id: string
          family_member_id: string | null
          id: string
          include_related_on_shift_days: boolean
          name: string
          schedule_id: string
          unsubscribe_token: string
          unsubscribed_at: string | null
          updated_at: string
          user_id: string | null
          weekdays: string[]
        }
        Insert: {
          content_mode?: string
          created_at?: string
          email: string
          family_id: string
          family_member_id?: string | null
          id?: string
          include_related_on_shift_days?: boolean
          name: string
          schedule_id: string
          unsubscribe_token?: string
          unsubscribed_at?: string | null
          updated_at?: string
          user_id?: string | null
          weekdays?: string[]
        }
        Update: {
          content_mode?: string
          created_at?: string
          email?: string
          family_id?: string
          family_member_id?: string | null
          id?: string
          include_related_on_shift_days?: boolean
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
          dst_repair: Json | null
          event_id: string
          family_id: string
          google_etag: string | null
          google_event_id: string
          google_original_start: string | null
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
          dst_repair?: Json | null
          event_id: string
          family_id: string
          google_etag?: string | null
          google_event_id: string
          google_original_start?: string | null
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
          dst_repair?: Json | null
          event_id?: string
          family_id?: string
          google_etag?: string | null
          google_event_id?: string
          google_original_start?: string | null
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
          split_from_date: string | null
          split_from_event_id: string | null
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
          split_from_date?: string | null
          split_from_event_id?: string | null
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
          split_from_date?: string | null
          split_from_event_id?: string | null
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
          {
            foreignKeyName: "events_split_from_event_id_fkey"
            columns: ["split_from_event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      families: {
        Row: {
          babysitter_calendar_source_id: string | null
          created_at: string
          created_by: string | null
          default_babysitter_family_user_id: string | null
          default_babysitter_member_id: string | null
          id: string
          include_google_event_initials: boolean
          name: string
          onboarding_finished_at: string | null
          timesheets_enabled: boolean
          timezone: string
          updated_at: string
        }
        Insert: {
          babysitter_calendar_source_id?: string | null
          created_at?: string
          created_by?: string | null
          default_babysitter_family_user_id?: string | null
          default_babysitter_member_id?: string | null
          id?: string
          include_google_event_initials?: boolean
          name: string
          onboarding_finished_at?: string | null
          timesheets_enabled?: boolean
          timezone?: string
          updated_at?: string
        }
        Update: {
          babysitter_calendar_source_id?: string | null
          created_at?: string
          created_by?: string | null
          default_babysitter_family_user_id?: string | null
          default_babysitter_member_id?: string | null
          id?: string
          include_google_event_initials?: boolean
          name?: string
          onboarding_finished_at?: string | null
          timesheets_enabled?: boolean
          timezone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "families_babysitter_calendar_source_id_fkey"
            columns: ["babysitter_calendar_source_id"]
            isOneToOne: false
            referencedRelation: "calendar_sources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "families_default_babysitter_family_user_id_fkey"
            columns: ["default_babysitter_family_user_id"]
            isOneToOne: false
            referencedRelation: "babysitter_access_profiles"
            referencedColumns: ["family_user_id"]
          },
          {
            foreignKeyName: "families_default_babysitter_member_id_fkey"
            columns: ["default_babysitter_member_id"]
            isOneToOne: false
            referencedRelation: "family_members"
            referencedColumns: ["id"]
          },
        ]
      }
      family_invitations: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          babysitter_calendar_ids: string[]
          babysitter_date_scope:
            | Database["public"]["Enums"]["babysitter_date_scope"]
            | null
          babysitter_family_member_id: string | null
          created_at: string
          email: string
          expires_at: string
          family_id: string
          family_member_id: string | null
          id: string
          invited_by: string | null
          is_babysitter: boolean
          role: Database["public"]["Enums"]["family_role"]
          status: Database["public"]["Enums"]["invitation_status"]
          token: string
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          babysitter_calendar_ids?: string[]
          babysitter_date_scope?:
            | Database["public"]["Enums"]["babysitter_date_scope"]
            | null
          babysitter_family_member_id?: string | null
          created_at?: string
          email: string
          expires_at?: string
          family_id: string
          family_member_id?: string | null
          id?: string
          invited_by?: string | null
          is_babysitter?: boolean
          role?: Database["public"]["Enums"]["family_role"]
          status?: Database["public"]["Enums"]["invitation_status"]
          token?: string
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          babysitter_calendar_ids?: string[]
          babysitter_date_scope?:
            | Database["public"]["Enums"]["babysitter_date_scope"]
            | null
          babysitter_family_member_id?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          family_id?: string
          family_member_id?: string | null
          id?: string
          invited_by?: string | null
          is_babysitter?: boolean
          role?: Database["public"]["Enums"]["family_role"]
          status?: Database["public"]["Enums"]["invitation_status"]
          token?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "family_invitations_babysitter_family_member_id_fkey"
            columns: ["babysitter_family_member_id"]
            isOneToOne: false
            referencedRelation: "family_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "family_invitations_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "family_invitations_family_member_id_fkey"
            columns: ["family_member_id"]
            isOneToOne: false
            referencedRelation: "family_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "family_invitations_member_same_family"
            columns: ["family_member_id", "family_id"]
            isOneToOne: false
            referencedRelation: "family_members"
            referencedColumns: ["id", "family_id"]
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
          onboarding_invite_email: string | null
          removed_at: string | null
          role: Database["public"]["Enums"]["member_role"]
          sort_order: number
          timesheet_emails_enabled: boolean
          timesheet_start_date: string | null
          timesheets_enabled: boolean
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
          onboarding_invite_email?: string | null
          removed_at?: string | null
          role?: Database["public"]["Enums"]["member_role"]
          sort_order?: number
          timesheet_emails_enabled?: boolean
          timesheet_start_date?: string | null
          timesheets_enabled?: boolean
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
          onboarding_invite_email?: string | null
          removed_at?: string | null
          role?: Database["public"]["Enums"]["member_role"]
          sort_order?: number
          timesheet_emails_enabled?: boolean
          timesheet_start_date?: string | null
          timesheets_enabled?: boolean
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
          manual_sync_attempt_id: string | null
          manual_sync_error: string | null
          manual_sync_started_at: string | null
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
          manual_sync_attempt_id?: string | null
          manual_sync_error?: string | null
          manual_sync_started_at?: string | null
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
          manual_sync_attempt_id?: string | null
          manual_sync_error?: string | null
          manual_sync_started_at?: string | null
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
      google_sync_outbox: {
        Row: {
          attempts: number
          calendar_source_id: string | null
          created_at: string
          delivery_version: string
          event_id: string | null
          family_id: string
          google_event_id: string | null
          id: string
          kind: string
          last_error: string | null
          lease_token: string | null
          lease_until: string | null
          op_key: string
          payload: Json
          status: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          calendar_source_id?: string | null
          created_at?: string
          delivery_version?: string
          event_id?: string | null
          family_id: string
          google_event_id?: string | null
          id?: string
          kind: string
          last_error?: string | null
          lease_token?: string | null
          lease_until?: string | null
          op_key: string
          payload: Json
          status?: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          calendar_source_id?: string | null
          created_at?: string
          delivery_version?: string
          event_id?: string | null
          family_id?: string
          google_event_id?: string | null
          id?: string
          kind?: string
          last_error?: string | null
          lease_token?: string | null
          lease_until?: string | null
          op_key?: string
          payload?: Json
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "google_sync_outbox_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      ics_subscription_secrets: {
        Row: {
          created_at: string
          source_id: string
          updated_at: string
          url_ciphertext: string
          url_hint: string
        }
        Insert: {
          created_at?: string
          source_id: string
          updated_at?: string
          url_ciphertext: string
          url_hint: string
        }
        Update: {
          created_at?: string
          source_id?: string
          updated_at?: string
          url_ciphertext?: string
          url_hint?: string
        }
        Relationships: [
          {
            foreignKeyName: "ics_subscription_secrets_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: true
            referencedRelation: "calendar_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      native_auth_handoffs: {
        Row: {
          challenge: string
          code_expires_at: string | null
          code_hash: string | null
          completed_at: string | null
          consumed_at: string | null
          created_at: string
          expires_at: string
          id: string
          refresh_token_enc: string | null
          user_id: string | null
        }
        Insert: {
          challenge: string
          code_expires_at?: string | null
          code_hash?: string | null
          completed_at?: string | null
          consumed_at?: string | null
          created_at?: string
          expires_at: string
          id?: string
          refresh_token_enc?: string | null
          user_id?: string | null
        }
        Update: {
          challenge?: string
          code_expires_at?: string | null
          code_hash?: string | null
          completed_at?: string | null
          consumed_at?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          refresh_token_enc?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      onboarding_member_invites: {
        Row: {
          email: string
          family_id: string
          family_member_id: string
        }
        Insert: {
          email: string
          family_id: string
          family_member_id: string
        }
        Update: {
          email?: string
          family_id?: string
          family_member_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "onboarding_member_invites_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "onboarding_member_invites_family_member_id_fkey"
            columns: ["family_member_id"]
            isOneToOne: true
            referencedRelation: "family_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "onboarding_member_invites_same_family"
            columns: ["family_member_id", "family_id"]
            isOneToOne: false
            referencedRelation: "family_members"
            referencedColumns: ["id", "family_id"]
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
      schedule_publish_qa_gates: {
        Row: {
          created_at: string
          enabled: boolean
          family_id: string
          note: string | null
          owner_user_id: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          family_id: string
          note?: string | null
          owner_user_id: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          family_id?: string
          note?: string | null
          owner_user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "schedule_publish_qa_gates_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      scheduler_credentials: {
        Row: {
          name: string
          token: string
          updated_at: string
        }
        Insert: {
          name: string
          token: string
          updated_at?: string
        }
        Update: {
          name?: string
          token?: string
          updated_at?: string
        }
        Relationships: []
      }
      scheduler_runs: {
        Row: {
          detail: string | null
          id: string
          job_name: string
          ran_at: string
          status: string
        }
        Insert: {
          detail?: string | null
          id?: string
          job_name: string
          ran_at?: string
          status: string
        }
        Update: {
          detail?: string | null
          id?: string
          job_name?: string
          ran_at?: string
          status?: string
        }
        Relationships: []
      }
      timesheet_entries: {
        Row: {
          actual_end: string
          actual_start: string
          actual_time_confirmed: boolean
          caregiver_actual_end: string | null
          caregiver_actual_start: string | null
          caregiver_note: string | null
          created_at: string
          event_id: string | null
          family_id: string
          id: string
          is_manual: boolean
          note: string | null
          occurrence_key: string | null
          owner_edited_at: string | null
          owner_edited_by: string | null
          paid_hours: number | null
          paid_note: string | null
          schedule_conflict_at: string | null
          schedule_conflict_reason: string | null
          scheduled_end: string | null
          scheduled_start: string | null
          scheduled_title: string | null
          timesheet_id: string
          updated_at: string
          work_date: string
        }
        Insert: {
          actual_end: string
          actual_start: string
          actual_time_confirmed?: boolean
          caregiver_actual_end?: string | null
          caregiver_actual_start?: string | null
          caregiver_note?: string | null
          created_at?: string
          event_id?: string | null
          family_id: string
          id?: string
          is_manual?: boolean
          note?: string | null
          occurrence_key?: string | null
          owner_edited_at?: string | null
          owner_edited_by?: string | null
          paid_hours?: number | null
          paid_note?: string | null
          schedule_conflict_at?: string | null
          schedule_conflict_reason?: string | null
          scheduled_end?: string | null
          scheduled_start?: string | null
          scheduled_title?: string | null
          timesheet_id: string
          updated_at?: string
          work_date: string
        }
        Update: {
          actual_end?: string
          actual_start?: string
          actual_time_confirmed?: boolean
          caregiver_actual_end?: string | null
          caregiver_actual_start?: string | null
          caregiver_note?: string | null
          created_at?: string
          event_id?: string | null
          family_id?: string
          id?: string
          is_manual?: boolean
          note?: string | null
          occurrence_key?: string | null
          owner_edited_at?: string | null
          owner_edited_by?: string | null
          paid_hours?: number | null
          paid_note?: string | null
          schedule_conflict_at?: string | null
          schedule_conflict_reason?: string | null
          scheduled_end?: string | null
          scheduled_start?: string | null
          scheduled_title?: string | null
          timesheet_id?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "timesheet_entries_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timesheet_entries_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timesheet_entries_timesheet_id_fkey"
            columns: ["timesheet_id"]
            isOneToOne: false
            referencedRelation: "timesheets"
            referencedColumns: ["id"]
          },
        ]
      }
      timesheet_notifications: {
        Row: {
          created_at: string
          detail: string | null
          family_id: string
          family_member_id: string | null
          id: string
          kind: string
          recipient: string
          status: string
          timesheet_id: string | null
          updated_at: string
          version_key: string
        }
        Insert: {
          created_at?: string
          detail?: string | null
          family_id: string
          family_member_id?: string | null
          id?: string
          kind: string
          recipient: string
          status?: string
          timesheet_id?: string | null
          updated_at?: string
          version_key: string
        }
        Update: {
          created_at?: string
          detail?: string | null
          family_id?: string
          family_member_id?: string | null
          id?: string
          kind?: string
          recipient?: string
          status?: string
          timesheet_id?: string | null
          updated_at?: string
          version_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "timesheet_notifications_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timesheet_notifications_family_member_id_fkey"
            columns: ["family_member_id"]
            isOneToOne: false
            referencedRelation: "family_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timesheet_notifications_timesheet_id_fkey"
            columns: ["timesheet_id"]
            isOneToOne: false
            referencedRelation: "timesheets"
            referencedColumns: ["id"]
          },
        ]
      }
      timesheet_reconcile_jobs: {
        Row: {
          attempts: number
          created_at: string
          family_id: string
          id: string
          last_error: string | null
          member_ids: string[]
          updated_at: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          family_id: string
          id?: string
          last_error?: string | null
          member_ids?: string[]
          updated_at?: string
        }
        Update: {
          attempts?: number
          created_at?: string
          family_id?: string
          id?: string
          last_error?: string | null
          member_ids?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "timesheet_reconcile_jobs_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      timesheet_settings: {
        Row: {
          anchor_date: string
          created_at: string
          family_id: string
          frequency: string
          notify_approved: boolean
          notify_correction: boolean
          notify_owner_submit: boolean
          notify_ready: boolean
          notify_reminder: boolean
          semimonthly_first_end: number
          updated_at: string
        }
        Insert: {
          anchor_date?: string
          created_at?: string
          family_id: string
          frequency?: string
          notify_approved?: boolean
          notify_correction?: boolean
          notify_owner_submit?: boolean
          notify_ready?: boolean
          notify_reminder?: boolean
          semimonthly_first_end?: number
          updated_at?: string
        }
        Update: {
          anchor_date?: string
          created_at?: string
          family_id?: string
          frequency?: string
          notify_approved?: boolean
          notify_correction?: boolean
          notify_owner_submit?: boolean
          notify_ready?: boolean
          notify_reminder?: boolean
          semimonthly_first_end?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "timesheet_settings_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: true
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      timesheets: {
        Row: {
          caregiver_name: string
          closed_at: string | null
          closed_by: string | null
          created_at: string
          family_id: string
          family_member_id: string
          id: string
          owner_edited_at: string | null
          owner_edited_by: string | null
          owner_managed: boolean
          parent_note: string | null
          period_end: string
          period_start: string
          reviewed_at: string | null
          reviewed_by: string | null
          snapshot: Json | null
          status: string
          submitted_at: string | null
          submitted_snapshot: Json | null
          updated_at: string
        }
        Insert: {
          caregiver_name: string
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          family_id: string
          family_member_id: string
          id?: string
          owner_edited_at?: string | null
          owner_edited_by?: string | null
          owner_managed?: boolean
          parent_note?: string | null
          period_end: string
          period_start: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          snapshot?: Json | null
          status?: string
          submitted_at?: string | null
          submitted_snapshot?: Json | null
          updated_at?: string
        }
        Update: {
          caregiver_name?: string
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          family_id?: string
          family_member_id?: string
          id?: string
          owner_edited_at?: string | null
          owner_edited_by?: string | null
          owner_managed?: boolean
          parent_note?: string | null
          period_end?: string
          period_start?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          snapshot?: Json | null
          status?: string
          submitted_at?: string | null
          submitted_snapshot?: Json | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "timesheets_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timesheets_family_member_id_fkey"
            columns: ["family_member_id"]
            isOneToOne: false
            referencedRelation: "family_members"
            referencedColumns: ["id"]
          },
        ]
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
      accept_household_invitation: {
        Args: { _invitation_id: string; _user_id: string }
        Returns: Json
      }
      account_deletion_blocked: { Args: { _user_id: string }; Returns: boolean }
      apply_schedule_publish_op: {
        Args: {
          _caller: string
          _draft: string
          _family: string
          _op: Json
          _revision: number
          _run: string
          _shift: Json
          _source: string
          _timezone: string
        }
        Returns: Json
      }
      assert_google_inbound_idle: {
        Args: { _event: string; _family: string }
        Returns: undefined
      }
      babysitter_membership: { Args: { _family_id: string }; Returns: string }
      can_edit_family: { Args: { _family_id: string }; Returns: boolean }
      can_read_calendar_source: {
        Args: { _family_id: string; _source_id: string }
        Returns: boolean
      }
      can_read_event: {
        Args: {
          _end: string
          _event_id: string
          _family_id: string
          _recurrence: string
          _source_id: string
          _start: string
        }
        Returns: boolean
      }
      check_google_delivery_lease: {
        Args: {
          _family: string
          _key: string
          _token: string
          _version: string
        }
        Returns: boolean
      }
      claim_google_delivery: {
        Args: {
          _event: string
          _family: string
          _key: string
          _payload: Json
          _source: string
          _token: string
        }
        Returns: Json
      }
      complete_onboarding_invitation: {
        Args: { _actor: string; _family: string; _member: string }
        Returns: Json
      }
      consume_auth_lookup: {
        Args: { _bucket: string; _max: number; _window_seconds: number }
        Returns: boolean
      }
      correct_timesheet_entry_atomic: {
        Args: {
          _actor: string
          _entry: string
          _family: string
          _patch: Json
          _sheet: string
        }
        Returns: undefined
      }
      delete_account_data: {
        Args: {
          _delete_households: string[]
          _email: string
          _transfers: Json
          _user_id: string
        }
        Returns: Json
      }
      delete_google_inbound_event: {
        Args: { _event: string; _family: string }
        Returns: undefined
      }
      delete_timesheet_entry_atomic: {
        Args: {
          _actor: string
          _entry: string
          _family: string
          _member: string
          _sheet: string
        }
        Returns: undefined
      }
      enqueue_google_manual_sync: {
        Args: {
          _attempt_id: string
          _callback_url: string
          _family_id: string
          _initial?: boolean
        }
        Returns: number
      }
      family_role_of: {
        Args: { _family_id: string }
        Returns: Database["public"]["Enums"]["family_role"]
      }
      finish_google_branch_deletion: {
        Args: {
          _family: string
          _key: string
          _remote: string
          _token: string
          _version: string
        }
        Returns: boolean
      }
      finish_google_delivery: {
        Args: {
          _error?: string
          _family: string
          _key: string
          _remote: string
          _token: string
          _version: string
        }
        Returns: boolean
      }
      google_apply_exception_atomic: {
        Args: {
          _day: string
          _event: Json
          _family: string
          _member_ids: Json
          _parent: string
          _source: string
        }
        Returns: string
      }
      has_family_access: { Args: { _family_id: string }; Returns: boolean }
      is_babysitter: { Args: { _family_id: string }; Returns: boolean }
      is_family_owner: { Args: { _family_id: string }; Returns: boolean }
      keep_caregiver_login_as_viewer: {
        Args: { _member_id: string }
        Returns: number
      }
      lock_timesheet_household: {
        Args: { _family: string }
        Returns: undefined
      }
      merge_event_exclusions_atomic: {
        Args: {
          _dates: string[]
          _event: string
          _family: string
          _source?: string
        }
        Returns: string[]
      }
      my_caregiver_member_id: { Args: { _family_id: string }; Returns: string }
      owner_delete_managed_entry_atomic: {
        Args: {
          _actor: string
          _entry: string
          _family: string
          _sheet: string
        }
        Returns: undefined
      }
      owner_save_managed_entry_atomic: {
        Args: {
          _actor: string
          _end: string
          _entry: string
          _family: string
          _note: string
          _paid_hours: number
          _paid_note: string
          _sheet: string
          _start: string
          _work_date: string
        }
        Returns: undefined
      }
      queue_google_event_delivery: {
        Args: { _event: string }
        Returns: undefined
      }
      reconcile_shift_timesheets_atomic: {
        Args: {
          _family: string
          _items: Json
          _settings: Json
          _timezone: string
          _today: string
        }
        Returns: number
      }
      recover_stale_account_deletion: {
        Args: { _user_id: string }
        Returns: string
      }
      refresh_timesheet_atomic: {
        Args: {
          _end: string
          _family: string
          _member: string
          _settings: Json
          _shifts: Json
          _start: string
          _timezone: string
          _today: string
        }
        Returns: Json
      }
      remove_caregiver_app_access: {
        Args: { _member_id: string }
        Returns: number
      }
      remove_google_inbound_branch: {
        Args: { _event: string; _family: string; _link: string }
        Returns: undefined
      }
      resolve_timesheet_conflict_atomic: {
        Args: {
          _action: string
          _actor: string
          _entry: string
          _family: string
          _member: string
          _sheet: string
        }
        Returns: undefined
      }
      save_timesheet_entry_atomic: {
        Args: {
          _actor: string
          _end: string
          _entry: string
          _family: string
          _member: string
          _note: string
          _paid_hours: number
          _paid_note: string
          _sheet: string
          _start: string
          _work_date: string
        }
        Returns: undefined
      }
      save_timesheet_schedule_atomic: {
        Args: { _family: string; _settings: Json; _validated_periods: Json }
        Returns: undefined
      }
      set_caregiver_access: {
        Args: {
          _calendar_ids: string[]
          _date_scope: Database["public"]["Enums"]["babysitter_date_scope"]
          _family_member_id: string
          _membership_id: string
        }
        Returns: undefined
      }
      split_calendar_event_atomic: {
        Args: { _day: string; _event: string; _input: Json; _scope: string }
        Returns: string
      }
      timesheet_entry_duplicate_classification: {
        Args: { _entry: string; _tz: string }
        Returns: string
      }
      timesheet_entry_duplicates_finalized: {
        Args: { _entry: string; _tz: string }
        Returns: boolean
      }
      timesheet_lineage_keys: {
        Args: { _event: string; _tz: string; _work_date: string }
        Returns: string[]
      }
      transition_timesheet_atomic: {
        Args: {
          _action: string
          _actor: string
          _family: string
          _member?: string
          _note?: string
          _sheet: string
        }
        Returns: undefined
      }
      try_start_google_manual_sync: {
        Args: { _family_id: string; _stale_before: string }
        Returns: {
          accepted: boolean
          attempt_id: string
        }[]
      }
    }
    Enums: {
      babysitter_date_scope: "all_permitted" | "shift_days_only"
      calendar_display_mode: "events" | "coverage_background"
      calendar_provider: "local" | "google" | "ics"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
      babysitter_date_scope: ["all_permitted", "shift_days_only"],
      calendar_display_mode: ["events", "coverage_background"],
      calendar_provider: ["local", "google", "ics"],
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
