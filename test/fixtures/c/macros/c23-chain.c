#if defined(LEVEL) && LEVEL > 2
int high = 1;
#elifdef LEVEL
int mid = 1;
#elifndef FALLBACK
int low = 1;
#else
int none = 1;
#endif
