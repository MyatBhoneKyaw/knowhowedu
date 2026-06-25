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
      badges: {
        Row: {
          code: string
          created_at: string
          description: string
          id: string
          name: string
          xp_reward: number
        }
        Insert: {
          code: string
          created_at?: string
          description?: string
          id?: string
          name: string
          xp_reward?: number
        }
        Update: {
          code?: string
          created_at?: string
          description?: string
          id?: string
          name?: string
          xp_reward?: number
        }
        Relationships: []
      }
      community_comments: {
        Row: {
          body: string
          created_at: string
          id: string
          post_id: string
          updated_at: string
          user_id: string
          votes: number
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          post_id: string
          updated_at?: string
          user_id: string
          votes?: number
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          post_id?: string
          updated_at?: string
          user_id?: string
          votes?: number
        }
        Relationships: [
          {
            foreignKeyName: "community_comments_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "community_posts"
            referencedColumns: ["id"]
          },
        ]
      }
      community_posts: {
        Row: {
          author_id: string
          body: string
          community: string
          created_at: string
          id: string
          linked_quest_id: string | null
          title: string
          updated_at: string
          votes: number
        }
        Insert: {
          author_id: string
          body: string
          community: string
          created_at?: string
          id?: string
          linked_quest_id?: string | null
          title: string
          updated_at?: string
          votes?: number
        }
        Update: {
          author_id?: string
          body?: string
          community?: string
          created_at?: string
          id?: string
          linked_quest_id?: string | null
          title?: string
          updated_at?: string
          votes?: number
        }
        Relationships: []
      }
      community_reactions: {
        Row: {
          comment_id: string | null
          created_at: string
          id: string
          post_id: string | null
          user_id: string
          value: number
        }
        Insert: {
          comment_id?: string | null
          created_at?: string
          id?: string
          post_id?: string | null
          user_id: string
          value?: number
        }
        Update: {
          comment_id?: string | null
          created_at?: string
          id?: string
          post_id?: string | null
          user_id?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "community_reactions_comment_id_fkey"
            columns: ["comment_id"]
            isOneToOne: false
            referencedRelation: "community_comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_reactions_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "community_posts"
            referencedColumns: ["id"]
          },
        ]
      }
      credit_transactions: {
        Row: {
          amount: number
          balance_after: number
          created_at: string
          description: string
          id: string
          session_id: string | null
          type: string
          user_id: string
        }
        Insert: {
          amount: number
          balance_after: number
          created_at?: string
          description: string
          id?: string
          session_id?: string | null
          type: string
          user_id: string
        }
        Update: {
          amount?: number
          balance_after?: number
          created_at?: string
          description?: string
          id?: string
          session_id?: string | null
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      loans: {
        Row: {
          amount: number
          created_at: string
          due_date: string
          id: string
          repaid_at: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          due_date: string
          id?: string
          repaid_at?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          due_date?: string
          id?: string
          repaid_at?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      matches: {
        Row: {
          action: string
          compatibility_score: number
          created_at: string
          from_user: string
          id: string
          is_mutual: boolean
          match_percentage: number
          skill_offered_id: string | null
          skill_wanted_id: string | null
          to_user: string
          updated_at: string
        }
        Insert: {
          action: string
          compatibility_score?: number
          created_at?: string
          from_user: string
          id?: string
          is_mutual?: boolean
          match_percentage?: number
          skill_offered_id?: string | null
          skill_wanted_id?: string | null
          to_user: string
          updated_at?: string
        }
        Update: {
          action?: string
          compatibility_score?: number
          created_at?: string
          from_user?: string
          id?: string
          is_mutual?: boolean
          match_percentage?: number
          skill_offered_id?: string | null
          skill_wanted_id?: string | null
          to_user?: string
          updated_at?: string
        }
        Relationships: []
      }
      messages: {
        Row: {
          attachments: Json
          body: string
          created_at: string
          delivered_at: string | null
          file_url: string | null
          group_name: string | null
          id: string
          message_type: string
          reaction: string | null
          read_at: string | null
          recipient_id: string | null
          schedule: Json | null
          sender_id: string
          session_id: string | null
          updated_at: string
        }
        Insert: {
          attachments?: Json
          body: string
          created_at?: string
          delivered_at?: string | null
          file_url?: string | null
          group_name?: string | null
          id?: string
          message_type?: string
          reaction?: string | null
          read_at?: string | null
          recipient_id?: string | null
          schedule?: Json | null
          sender_id: string
          session_id?: string | null
          updated_at?: string
        }
        Update: {
          attachments?: Json
          body?: string
          created_at?: string
          delivered_at?: string | null
          file_url?: string | null
          group_name?: string | null
          id?: string
          message_type?: string
          reaction?: string | null
          read_at?: string | null
          recipient_id?: string | null
          schedule?: Json | null
          sender_id?: string
          session_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          body: string
          created_at: string
          id: string
          is_read: boolean
          title: string
          type: string
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          is_read?: boolean
          title: string
          type?: string
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          is_read?: boolean
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          average_rating: number
          badges: Json
          created_at: string
          daily_streak: number
          email: string
          full_name: string
          google_id: string | null
          hours_shared: number
          id: string
          is_suspended: boolean
          learning_profile: Json
          level: string
          profile: Json
          raw_role: string
          reputation_score: number
          session_completion_rate: number
          subject_levels: Json
          teaching_profile: Json
          two_factor_enabled: boolean
          updated_at: string
          username: string
          xp: number
        }
        Insert: {
          average_rating?: number
          badges?: Json
          created_at?: string
          daily_streak?: number
          email: string
          full_name?: string
          google_id?: string | null
          hours_shared?: number
          id: string
          is_suspended?: boolean
          learning_profile?: Json
          level?: string
          profile?: Json
          raw_role?: string
          reputation_score?: number
          session_completion_rate?: number
          subject_levels?: Json
          teaching_profile?: Json
          two_factor_enabled?: boolean
          updated_at?: string
          username: string
          xp?: number
        }
        Update: {
          average_rating?: number
          badges?: Json
          created_at?: string
          daily_streak?: number
          email?: string
          full_name?: string
          google_id?: string | null
          hours_shared?: number
          id?: string
          is_suspended?: boolean
          learning_profile?: Json
          level?: string
          profile?: Json
          raw_role?: string
          reputation_score?: number
          session_completion_rate?: number
          subject_levels?: Json
          teaching_profile?: Json
          two_factor_enabled?: boolean
          updated_at?: string
          username?: string
          xp?: number
        }
        Relationships: []
      }
      purchases: {
        Row: {
          amount_paid: number
          created_at: string
          credits: number
          currency: string
          id: string
          product_type: string
          status: string
          title: string
          user_id: string
        }
        Insert: {
          amount_paid?: number
          created_at?: string
          credits?: number
          currency?: string
          id?: string
          product_type: string
          status?: string
          title: string
          user_id: string
        }
        Update: {
          amount_paid?: number
          created_at?: string
          credits?: number
          currency?: string
          id?: string
          product_type?: string
          status?: string
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      quests: {
        Row: {
          completed_at: string | null
          created_at: string
          detail: string
          difficulty: string
          id: string
          linked_post_id: string | null
          requester_id: string
          reward_credits: number
          solution_note: string | null
          status: string
          subject: string
          title: string
          tutor_id: string | null
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          detail?: string
          difficulty?: string
          id?: string
          linked_post_id?: string | null
          requester_id: string
          reward_credits: number
          solution_note?: string | null
          status?: string
          subject: string
          title: string
          tutor_id?: string | null
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          detail?: string
          difficulty?: string
          id?: string
          linked_post_id?: string | null
          requester_id?: string
          reward_credits?: number
          solution_note?: string | null
          status?: string
          subject?: string
          title?: string
          tutor_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      reviews: {
        Row: {
          communication_feedback: string
          created_at: string
          id: string
          rating: number
          reviewee_id: string
          reviewer_id: string
          session_id: string
          session_quality_feedback: string
          skill_feedback: string
          written_review: string
        }
        Insert: {
          communication_feedback?: string
          created_at?: string
          id?: string
          rating: number
          reviewee_id: string
          reviewer_id: string
          session_id: string
          session_quality_feedback?: string
          skill_feedback?: string
          written_review?: string
        }
        Update: {
          communication_feedback?: string
          created_at?: string
          id?: string
          rating?: number
          reviewee_id?: string
          reviewer_id?: string
          session_id?: string
          session_quality_feedback?: string
          skill_feedback?: string
          written_review?: string
        }
        Relationships: [
          {
            foreignKeyName: "reviews_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      session_attendance: {
        Row: {
          created_at: string
          duration_minutes: number
          id: string
          joined_at: string
          left_at: string | null
          role: string
          session_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          duration_minutes?: number
          id?: string
          joined_at: string
          left_at?: string | null
          role: string
          session_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          duration_minutes?: number
          id?: string
          joined_at?: string
          left_at?: string | null
          role?: string
          session_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_attendance_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      sessions: {
        Row: {
          actual_duration_minutes: number
          attendance_verified: boolean
          completed_at: string | null
          created_at: string
          credit_amount: number
          credit_rate_per_minute: number
          date: string
          duration_hours: number
          id: string
          learner_id: string | null
          learner_joined_at: string | null
          learner_left_at: string | null
          learning_summary: Json | null
          meeting_link: string
          meeting_provider: string
          meeting_space_name: string
          mentor_joined_at: string | null
          mentor_left_at: string | null
          notes: string
          requested_by: string
          room_id: string
          seats_available: number
          skill_category: string
          skill_topic: string
          status: string
          student_limit: number
          teacher_id: string
          teacher_level: string
          updated_at: string
          verified_duration_minutes: number
        }
        Insert: {
          actual_duration_minutes?: number
          attendance_verified?: boolean
          completed_at?: string | null
          created_at?: string
          credit_amount: number
          credit_rate_per_minute?: number
          date: string
          duration_hours: number
          id?: string
          learner_id?: string | null
          learner_joined_at?: string | null
          learner_left_at?: string | null
          learning_summary?: Json | null
          meeting_link?: string
          meeting_provider?: string
          meeting_space_name?: string
          mentor_joined_at?: string | null
          mentor_left_at?: string | null
          notes?: string
          requested_by: string
          room_id: string
          seats_available?: number
          skill_category?: string
          skill_topic: string
          status?: string
          student_limit?: number
          teacher_id: string
          teacher_level?: string
          updated_at?: string
          verified_duration_minutes?: number
        }
        Update: {
          actual_duration_minutes?: number
          attendance_verified?: boolean
          completed_at?: string | null
          created_at?: string
          credit_amount?: number
          credit_rate_per_minute?: number
          date?: string
          duration_hours?: number
          id?: string
          learner_id?: string | null
          learner_joined_at?: string | null
          learner_left_at?: string | null
          learning_summary?: Json | null
          meeting_link?: string
          meeting_provider?: string
          meeting_space_name?: string
          mentor_joined_at?: string | null
          mentor_left_at?: string | null
          notes?: string
          requested_by?: string
          room_id?: string
          seats_available?: number
          skill_category?: string
          skill_topic?: string
          status?: string
          student_limit?: number
          teacher_id?: string
          teacher_level?: string
          updated_at?: string
          verified_duration_minutes?: number
        }
        Relationships: []
      }
      skills_offered: {
        Row: {
          availability: Json
          category: string
          created_at: string
          description: string
          experience_level: string
          id: string
          is_verified: boolean
          location_mode: string
          name: string
          session_duration: number
          teaching_language: string
          updated_at: string
          user_id: string
        }
        Insert: {
          availability?: Json
          category: string
          created_at?: string
          description?: string
          experience_level?: string
          id?: string
          is_verified?: boolean
          location_mode?: string
          name: string
          session_duration?: number
          teaching_language?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          availability?: Json
          category?: string
          created_at?: string
          description?: string
          experience_level?: string
          id?: string
          is_verified?: boolean
          location_mode?: string
          name?: string
          session_duration?: number
          teaching_language?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      skills_wanted: {
        Row: {
          availability: Json
          category: string
          created_at: string
          id: string
          learning_goals: string
          location_mode: string
          name: string
          preferred_language: string
          target_proficiency: string
          updated_at: string
          user_id: string
        }
        Insert: {
          availability?: Json
          category: string
          created_at?: string
          id?: string
          learning_goals?: string
          location_mode?: string
          name: string
          preferred_language?: string
          target_proficiency?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          availability?: Json
          category?: string
          created_at?: string
          id?: string
          learning_goals?: string
          location_mode?: string
          name?: string
          preferred_language?: string
          target_proficiency?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      teacher_applications: {
        Row: {
          admin_note: string | null
          authority_name: string | null
          created_at: string
          cv_url: string | null
          id: string
          learner_level: string | null
          license_url: string | null
          linked_in_url: string | null
          note: string | null
          requested_role: string
          reviewed_at: string | null
          status: string
          subject: string
          teacher_level_claim: string | null
          user_id: string
        }
        Insert: {
          admin_note?: string | null
          authority_name?: string | null
          created_at?: string
          cv_url?: string | null
          id?: string
          learner_level?: string | null
          license_url?: string | null
          linked_in_url?: string | null
          note?: string | null
          requested_role: string
          reviewed_at?: string | null
          status?: string
          subject: string
          teacher_level_claim?: string | null
          user_id: string
        }
        Update: {
          admin_note?: string | null
          authority_name?: string | null
          created_at?: string
          cv_url?: string | null
          id?: string
          learner_level?: string | null
          license_url?: string | null
          linked_in_url?: string | null
          note?: string | null
          requested_role?: string
          reviewed_at?: string | null
          status?: string
          subject?: string
          teacher_level_claim?: string | null
          user_id?: string
        }
        Relationships: []
      }
      user_quests: {
        Row: {
          created_at: string
          id: string
          quest_id: string
          status: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          quest_id: string
          status?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          quest_id?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_quests_quest_id_fkey"
            columns: ["quest_id"]
            isOneToOne: false
            referencedRelation: "quests"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      verification_requests: {
        Row: {
          admin_note: string | null
          badge_requested: string
          created_at: string
          evidence_url: string | null
          id: string
          method: string
          notes: string | null
          skill_id: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          admin_note?: string | null
          badge_requested: string
          created_at?: string
          evidence_url?: string | null
          id?: string
          method: string
          notes?: string | null
          skill_id?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          admin_note?: string | null
          badge_requested?: string
          created_at?: string
          evidence_url?: string | null
          id?: string
          method?: string
          notes?: string | null
          skill_id?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      wallets: {
        Row: {
          current_credits: number
          earned_credits: number
          lecture_access: number
          loan_due_date: string | null
          loan_limit: number
          loan_outstanding: number
          purchased_credits: number
          spent_credits: number
          updated_at: string
          user_id: string
        }
        Insert: {
          current_credits?: number
          earned_credits?: number
          lecture_access?: number
          loan_due_date?: string | null
          loan_limit?: number
          loan_outstanding?: number
          purchased_credits?: number
          spent_credits?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          current_credits?: number
          earned_credits?: number
          lecture_access?: number
          loan_due_date?: string | null
          loan_limit?: number
          loan_outstanding?: number
          purchased_credits?: number
          spent_credits?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      session_complete: {
        Args: { _session_id: string }
        Returns: {
          actual_duration_minutes: number
          attendance_verified: boolean
          completed_at: string | null
          created_at: string
          credit_amount: number
          credit_rate_per_minute: number
          date: string
          duration_hours: number
          id: string
          learner_id: string | null
          learner_joined_at: string | null
          learner_left_at: string | null
          learning_summary: Json | null
          meeting_link: string
          meeting_provider: string
          meeting_space_name: string
          mentor_joined_at: string | null
          mentor_left_at: string | null
          notes: string
          requested_by: string
          room_id: string
          seats_available: number
          skill_category: string
          skill_topic: string
          status: string
          student_limit: number
          teacher_id: string
          teacher_level: string
          updated_at: string
          verified_duration_minutes: number
        }
        SetofOptions: {
          from: "*"
          to: "sessions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      session_join_seat: {
        Args: { _session_id: string }
        Returns: {
          actual_duration_minutes: number
          attendance_verified: boolean
          completed_at: string | null
          created_at: string
          credit_amount: number
          credit_rate_per_minute: number
          date: string
          duration_hours: number
          id: string
          learner_id: string | null
          learner_joined_at: string | null
          learner_left_at: string | null
          learning_summary: Json | null
          meeting_link: string
          meeting_provider: string
          meeting_space_name: string
          mentor_joined_at: string | null
          mentor_left_at: string | null
          notes: string
          requested_by: string
          room_id: string
          seats_available: number
          skill_category: string
          skill_topic: string
          status: string
          student_limit: number
          teacher_id: string
          teacher_level: string
          updated_at: string
          verified_duration_minutes: number
        }
        SetofOptions: {
          from: "*"
          to: "sessions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      wallet_purchase_credits: {
        Args: {
          _amount: number
          _credits: number
          _currency: string
          _title: string
        }
        Returns: {
          current_credits: number
          earned_credits: number
          lecture_access: number
          loan_due_date: string | null
          loan_limit: number
          loan_outstanding: number
          purchased_credits: number
          spent_credits: number
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "wallets"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      wallet_purchase_lecture: {
        Args: { _amount: number; _currency: string; _title: string }
        Returns: {
          current_credits: number
          earned_credits: number
          lecture_access: number
          loan_due_date: string | null
          loan_limit: number
          loan_outstanding: number
          purchased_credits: number
          spent_credits: number
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "wallets"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      wallet_repay_loan: {
        Args: { _amount: number }
        Returns: {
          current_credits: number
          earned_credits: number
          lecture_access: number
          loan_due_date: string | null
          loan_limit: number
          loan_outstanding: number
          purchased_credits: number
          spent_credits: number
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "wallets"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      wallet_take_loan: {
        Args: { _amount: number; _due: string }
        Returns: {
          current_credits: number
          earned_credits: number
          lecture_access: number
          loan_due_date: string | null
          loan_limit: number
          loan_outstanding: number
          purchased_credits: number
          spent_credits: number
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "wallets"
          isOneToOne: true
          isSetofReturn: false
        }
      }
    }
    Enums: {
      app_role: "admin" | "moderator" | "user"
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
      app_role: ["admin", "moderator", "user"],
    },
  },
} as const
