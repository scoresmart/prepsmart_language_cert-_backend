import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const url = new URL(req.url);
    const action = url.searchParams.get('action') || 'list';
    const section = url.searchParams.get('section');
    const title = url.searchParams.get('title');

    // Action: list - Returns all available task types with counts
    if (action === 'list') {
      const { data, error } = await supabase
        .from('pte_predictions')
        .select('section, title')
        .is('deleted_at', null);

      if (error) throw error;

      // Group by section and title
      const taskTypes: Record<string, { section: string; title: string; count: number }> = {};
      
      for (const row of data) {
        const key = `${row.section}::${row.title}`;
        if (!taskTypes[key]) {
          taskTypes[key] = { section: row.section, title: row.title, count: 0 };
        }
        taskTypes[key].count++;
      }

      // Count media files per task type
      const taskTypeList = Object.values(taskTypes).map(tt => {
        return {
          ...tt,
          exportUrl: `?action=export&section=${encodeURIComponent(tt.section)}&title=${encodeURIComponent(tt.title)}`
        };
      });

      // Sort by section then title
      taskTypeList.sort((a, b) => {
        if (a.section !== b.section) return a.section.localeCompare(b.section);
        return a.title.localeCompare(b.title);
      });

      return new Response(JSON.stringify({
        success: true,
        taskTypes: taskTypeList,
        totalTasks: taskTypeList.length,
        totalRecords: data.length
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Action: export - Export predictions for a specific task type
    if (action === 'export') {
      if (!section || !title) {
        return new Response(JSON.stringify({
          success: false,
          error: 'Missing required parameters: section and title'
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // Fetch predictions for this task type
      const { data: predictions, error } = await supabase
        .from('pte_predictions')
        .select('*')
        .eq('section', section)
        .eq('title', title)
        .is('deleted_at', null)
        .order('order_index', { ascending: true });

      if (error) throw error;

      // Extract all media URLs
      const mediaUrls: string[] = [];
      
      for (const pred of predictions) {
        if (pred.audio_url) {
          mediaUrls.push(pred.audio_url);
        }
        if (pred.image_urls && Array.isArray(pred.image_urls)) {
          mediaUrls.push(...pred.image_urls);
        }
      }

      // Clean data for export (remove internal IDs that shouldn't transfer)
      const exportData = predictions.map(pred => ({
        // Core content
        section: pred.section,
        title: pred.title,
        content: pred.content,
        order_index: pred.order_index,
        
        // Media
        audio_url: pred.audio_url,
        image_urls: pred.image_urls,
        
        // Blank options for FIB questions
        blank_options: pred.blank_options,
        
        // Metadata
        is_active: pred.is_active,
        created_at: pred.created_at,
        
        // Original ID for reference/mapping
        _original_id: pred.id
      }));

      const fileName = `${section}-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.json`;

      return new Response(JSON.stringify({
        success: true,
        meta: {
          section,
          title,
          recordCount: predictions.length,
          mediaFileCount: mediaUrls.length,
          exportedAt: new Date().toISOString(),
          sourceProject: 'sepzceaicoldqhyxxzff',
          fileName
        },
        mediaUrls,
        predictions: exportData
      }, null, 2), {
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'application/json',
          'Content-Disposition': `attachment; filename="${fileName}"`
        }
      });
    }

    // Action: export-all - Export all predictions in one file (organized by task)
    if (action === 'export-all') {
      const { data: predictions, error } = await supabase
        .from('pte_predictions')
        .select('*')
        .is('deleted_at', null)
        .order('section')
        .order('title')
        .order('order_index');

      if (error) throw error;

      // Group by section and title
      const grouped: Record<string, Record<string, any[]>> = {};
      const allMediaUrls: string[] = [];

      for (const pred of predictions) {
        if (!grouped[pred.section]) {
          grouped[pred.section] = {};
        }
        if (!grouped[pred.section][pred.title]) {
          grouped[pred.section][pred.title] = [];
        }

        if (pred.audio_url) allMediaUrls.push(pred.audio_url);
        if (pred.image_urls) allMediaUrls.push(...pred.image_urls);

        grouped[pred.section][pred.title].push({
          section: pred.section,
          title: pred.title,
          content: pred.content,
          order_index: pred.order_index,
          audio_url: pred.audio_url,
          image_urls: pred.image_urls,
          blank_options: pred.blank_options,
          is_active: pred.is_active,
          created_at: pred.created_at,
          _original_id: pred.id
        });
      }

      return new Response(JSON.stringify({
        success: true,
        meta: {
          totalRecords: predictions.length,
          totalMediaFiles: allMediaUrls.length,
          exportedAt: new Date().toISOString(),
          sourceProject: 'sepzceaicoldqhyxxzff'
        },
        mediaUrls: allMediaUrls,
        predictions: grouped
      }, null, 2), {
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'application/json',
          'Content-Disposition': 'attachment; filename="pte-predictions-all.json"'
        }
      });
    }

    return new Response(JSON.stringify({
      success: false,
      error: 'Invalid action. Use: list, export, or export-all'
    }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error: unknown) {
    console.error('Export error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({
      success: false,
      error: errorMessage
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
