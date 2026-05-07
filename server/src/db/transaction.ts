import mongoose from 'mongoose';

function isTransactionUnsupported(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes('Transaction numbers are only allowed on a replica set member or mongos') ||
    message.includes('Transaction numbers are only allowed') ||
    message.includes('This MongoDB deployment does not support retryable writes')
  );
}

export async function withMongoTransaction<T>(
  work: (session?: mongoose.ClientSession) => Promise<T>,
): Promise<T> {
  try {
    return await mongoose.connection.transaction((session) => work(session));
  } catch (error) {
    if (!isTransactionUnsupported(error)) throw error;
    return work(undefined);
  }
}
