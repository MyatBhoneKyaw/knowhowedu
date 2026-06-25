
REVOKE EXECUTE ON FUNCTION public.wallet_take_loan(numeric, date) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.wallet_repay_loan(numeric) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.wallet_purchase_credits(numeric, numeric, text, text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.wallet_purchase_lecture(numeric, text, text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.session_complete(uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.session_join_seat(uuid) FROM anon, PUBLIC;
