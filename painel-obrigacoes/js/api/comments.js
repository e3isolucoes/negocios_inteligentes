import { supabase } from '../supabaseClient.js';
import { withCurrentWorkspace } from './workspaceContext.js';
import { awsData, isAwsDataBackend } from './awsDataClient.js';

export async function fetchComments(obligationId) {
  if (isAwsDataBackend()) return (await awsData.list('obligation_comments'))
    .filter((comment) => comment.obligation_id === obligationId)
    .sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));
  const { data, error } = await supabase
    .from('obligation_comments')
    .select('*')
    .eq('obligation_id', obligationId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data;
}

export async function createComment({ obligationId, authorId, authorName, body }) {
  if (isAwsDataBackend()) return awsData.create('obligation_comments', {
    obligation_id: obligationId, author_id: authorId, author_name: authorName, body,
  });
  const { data, error } = await supabase
    .from('obligation_comments')
    .insert(withCurrentWorkspace({ obligation_id: obligationId, author_id: authorId, author_name: authorName, body }))
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteComment(id) {
  if (isAwsDataBackend()) return awsData.remove('obligation_comments', id);
  const { error } = await supabase.from('obligation_comments').delete().eq('id', id);
  if (error) throw error;
}
