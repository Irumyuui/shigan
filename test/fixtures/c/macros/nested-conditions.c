#ifdef OUTER
int outer = 1;

#ifdef INNER
int inner = 1;
#else
int inner = 0;
#endif

#else

#if defined(A) && defined(B)
int both = 1;
#elif defined(A) || defined(B)
int one = 2;
#else
int none = 3;
#endif

#endif
